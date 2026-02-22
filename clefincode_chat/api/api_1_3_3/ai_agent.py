# your_app/your_app/api/ai_helpers.py
import json
import time
import requests
import frappe
import tiktoken
from frappe.model.document import Document
from typing import Optional, List, Dict, Any
from datetime import datetime
from bs4 import BeautifulSoup
import copy
import re


URL_PATTERN = re.compile(r'((?:https?://|http://|www\.)[^\s<\)]+)', re.IGNORECASE)


DOC_DOCTYPE = "ClefinCode AI Agent Profile"

# -------------------------
# Helpers to load profile
# -------------------------
def _get_profile(profile_key: Optional[str] = None, doc_doctype: Optional[str] = None):
    """
    Return profile doc by exact document name (profile_key) only,
    or the default profile (is_default), or the first available.
    Throws if none found.

    doc_doctype: name of the DocType that holds AI profiles (e.g. "ClefinCode AI Agent Profile")
    """
    doctype = (doc_doctype or DOC_DOCTYPE).strip()
    if not doctype:
        frappe.throw("DocType name for AI profiles is empty.")

    if profile_key:
        # ONLY lookup by exact document name
        if frappe.db.exists(doctype, profile_key):
            return frappe.get_doc(doctype, profile_key)
        frappe.throw(f"AI profile with name '{profile_key}' not found in DocType '{doctype}'.")

    # default profile (is_default)
    rows = frappe.get_all(doctype, filters={"is_default": 1}, limit=1)
    if rows:
        return frappe.get_doc(doctype, rows[0].name)

    # fallback to first available
    rows = frappe.get_all(doctype, limit=1)
    if rows:
        return frappe.get_doc(doctype, rows[0].name)

    frappe.throw(f"No AI profiles found in DocType '{doctype}'. Create one first.")


# -------------------------
# Build headers
# -------------------------
def _build_headers(profile: Document) -> Dict[str, str]:
    """
    Build HTTP headers for the request based on profile.auth_header_type and custom_headers.
    Uses API Key stored in profile.api_key (or profile.api_key_password if used).
    """
    headers = {"Content-Type": "application/json"}

    # some doctypes store API key in field named 'api_key' (per your DocType JSON)
    api_key = (getattr(profile, "api_key", "") or "").strip()
    if not api_key:
        frappe.throw(f"API Key is empty in profile '{profile.name}'. Please set it.")

    auth_type = (getattr(profile, "auth_header_type", "Bearer Authorization") or "Bearer Authorization").strip().lower()
    if "bearer" in auth_type or "authorization" in auth_type:
        headers["Authorization"] = f"Bearer {api_key}"
    elif "x-api-key" in auth_type:
        headers["x-api-key"] = api_key
    elif auth_type == "custom" or "custom" in auth_type:
        # rely on custom_headers below
        pass
    else:
        # default to bearer if unknown
        headers["Authorization"] = f"Bearer {api_key}"

    # merge custom headers (profile.custom_headers expected as JSON - list or dict)
    if getattr(profile, "custom_headers", None):
        try:
            ch = frappe.parse_json(getattr(profile, "custom_headers"))
        except Exception:
            try:
                ch = json.loads(getattr(profile, "custom_headers"))
            except Exception:
                ch = None

        if isinstance(ch, dict):
            for k, v in ch.items():
                headers[k] = v
        elif isinstance(ch, list):
            for item in ch:
                if isinstance(item, dict):
                    k = item.get("key") or item.get("name")
                    v = item.get("value") or item.get("val") or item.get("header")
                    if k:
                        headers[k] = v

    return headers


# -------------------------
# Parse response best-effort
# -------------------------
def _parse_response_json(provider: str, resp_json: Any) -> str:
    """
    Try to extract a readable textual reply from provider responses (OpenAI, Claude, Groq...).
    Returns a text string (may be JSON-stringified fallback if can't parse).
    """
    try:
        if resp_json is None:
            return ""

        # If already a string
        if isinstance(resp_json, str):
            return resp_json

        # OpenAI Responses API quick access
        if isinstance(resp_json, dict):
            if "output_text" in resp_json and isinstance(resp_json["output_text"], str):
                return resp_json["output_text"]

            if "output" in resp_json and isinstance(resp_json["output"], list):
                texts = []
                for item in resp_json["output"]:
                    if isinstance(item, dict):
                        content = item.get("content")
                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "output_text":
                                    texts.append(block.get("text", ""))
                        if item.get("type") == "message" and item.get("text"):
                            texts.append(item.get("text"))
                    else:
                        texts.append(str(item))
                if texts:
                    return "\n".join(texts)

            # ChatCompletion-style
            if "choices" in resp_json and isinstance(resp_json["choices"], list) and resp_json["choices"]:
                c0 = resp_json["choices"][0]
                if isinstance(c0, dict):
                    if "message" in c0 and isinstance(c0["message"], dict):
                        m = c0["message"]
                        content = m.get("content")
                        if isinstance(content, list):
                            texts = []
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "output_text":
                                    texts.append(block.get("text", ""))
                            if texts:
                                return "\n".join(texts)
                        elif isinstance(content, str):
                            return content
                    if "text" in c0 and isinstance(c0["text"], str):
                        return c0["text"]

            # Anthropic / Claude style
            if "completion" in resp_json and isinstance(resp_json["completion"], str):
                return resp_json["completion"]
            if "result" in resp_json and isinstance(resp_json["result"], str):
                return resp_json["result"]

        # If it's a list, join elements
        if isinstance(resp_json, list):
            parts = [json.dumps(x, ensure_ascii=False) if not isinstance(x, str) else x for x in resp_json]
            return "\n".join(parts)

        # last fallback: pretty JSON
        return json.dumps(resp_json, ensure_ascii=False, indent=2)
    except Exception as e:
        frappe.log_error(title="AI response parse error", message=str(e))
        try:
            return str(resp_json)
        except Exception:
            return ""


# -------------------------
# Main function
# -------------------------
def call_ai_service(
    profile_key: Optional[str] = None,
    prompt: Optional[str] = None,
    messages: Optional[List[Dict[str, Any]]] = None,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    extra_payload: Optional[Dict[str, Any]] = None,
    return_json: bool = False,
    use_responses_endpoint: bool = True,
    # new/common params for chat APIs
    system_prompt: Optional[str] = None,
    user: Optional[str] = None,
    conversation_id: Optional[str] = None,
    stop: Optional[List[str]] = None,
    top_p: Optional[float] = None,
    n: Optional[int] = None,
    presence_penalty: Optional[float] = None,
    frequency_penalty: Optional[float] = None,
    stream: Optional[bool] = False,
    # allow caller to pass which DocType holds the profile
    profile_doctype: Optional[str] = None,
) -> Any:
    """
    Generalized function to call AI providers based on a profile stored in a DocType.

    - profile_doctype: name of DocType that stores AI agent profiles (default DOC_DOCTYPE)
    - profile_key: exact document name in the DocType (if omitted, uses default profile or first one)
    - prompt: simple text prompt (single-turn)
    - messages: chat-style messages list [{"role":"user","content":"..."}, ...]
    - system_prompt: text for system instruction (will be injected as first message for chat endpoints)
    - model/temperature/max_tokens override profile defaults
    - extra_payload: dict to merge into final payload
    - return_json: if True returns the raw response JSON, otherwise returns best-effort text
    - use_responses_endpoint: prefer Responses API for OpenAI-style providers
    """
    # print(messages)
    profile = _get_profile(profile_key=profile_key, doc_doctype=profile_doctype)

    base_url = (getattr(profile, "url", "") or "").rstrip("/")
    if not base_url:
        frappe.throw(f"Profile '{profile.name}' has empty URL (base endpoint). Please set 'URL' field.")

    timeout = int(getattr(profile, "timeout_seconds", 60) or 60)
    retries = int(getattr(profile, "retry_count", 2) or 2)

    responses_path = getattr(profile, "endpoint_responses", "/v1/responses") or "/v1/responses"
    chat_path = getattr(profile, "endpoint_chat", "/v1/chat/completions") or "/v1/chat/completions"

    model = model or getattr(profile, "model", None) or getattr(profile, "default_model", None)
    temperature = 0.0 + (temperature if temperature is not None else (getattr(profile, "temperature", 0.7) or 0.7))
    max_tokens = max_tokens or getattr(profile, "max_tokens", None)

    headers = _build_headers(profile)

    provider = (getattr(profile, "provider", "openai") or "openai").strip().lower()
    url = None
    payload: Dict[str, Any] = {}
    print(provider)
    
    # Build per-provider payload & URL
    if provider == "openai":
        if use_responses_endpoint:
            url = f"{base_url}{responses_path}"
            # Responses endpoint expects an "input" which can be a string or list
            if messages:
                # when messages exist, convert to joined text but keep roles
                input_text = "\n".join([f"{m.get('role')}: {m.get('content')}" for m in messages])
                print(input_text)
            else:
                input_text = prompt or ""
                if system_prompt:
                    input_text = f"system: {system_prompt}\n\n{input_text}"
            payload = {"model": model or "gpt-3.5-turbo", "input": input_text}
            
            payload["temperature"] = temperature
            if max_tokens:
                payload["max_output_tokens"] = int(max_tokens)
            if user:
                payload["user"] = user
            if conversation_id:
                payload["conversation"] = conversation_id
            if stop:
                payload["stop"] = stop
            if n:
                payload["n"] = int(n)
            if top_p is not None:
                payload["top_p"] = float(top_p)
            if presence_penalty is not None:
                payload["presence_penalty"] = float(presence_penalty)
            if frequency_penalty is not None:
                payload["frequency_penalty"] = float(frequency_penalty)
            if stream:
                payload["stream"] = True
        else:
            url = f"{base_url}{chat_path}"

            chat_messages = []
            def _normalize_content_item(c):
               
                def _helper(x):
                    roles = set()

                  
                    if isinstance(x, str):
                        return {"type": "text", "text": x}, roles

             
                    if isinstance(x, list):
                        parts = []
                        for item in x:
                            norm_item, item_roles = _helper(item)
                            parts.append(norm_item.get("text", str(item)))
                            roles.update(item_roles)
                        text = " ".join(p for p in parts if p)
                        return {"type": "text", "text": text}, roles

             
                    if isinstance(x, dict):
                  
                        if "role" in x and isinstance(x["role"], str):
                            roles.add(x["role"])

               
                        if x.get("type") == "text" and isinstance(x.get("text"), str):
                            return {"type": "text", "text": x["text"]}, roles

          
                        if "text" in x and isinstance(x["text"], str):
                            return {"type": "text", "text": x["text"]}, roles

       
                        if "content" in x:
                            inner = x["content"]
                            norm_inner, inner_roles = _helper(inner)
                            roles.update(inner_roles)
                            return norm_inner, roles

                
                        for alt in ("message", "body", "payload", "data"):
                            if alt in x:
                                norm_alt, alt_roles = _helper(x[alt])
                                roles.update(alt_roles)
                                return norm_alt, roles

                    
                        for k, v in x.items():
                            if k == "role":
                                continue
                            norm_v, v_roles = _helper(v)
                            roles.update(v_roles)
                            return norm_v, roles

                        return {"type": "text", "text": str(x)}, roles

        
                    return {"type": "text", "text": str(x)}, roles

                normalized, collected_roles = _helper(c)

        
                if collected_roles:
                    if len(collected_roles) == 1:
                        normalized["role"] = next(iter(collected_roles))
                    else:
                        normalized["roles"] = list(collected_roles)

                return normalized
        

            if system_prompt:
      
                sys_text = str(system_prompt).strip().strip("'\n").strip('"')
                chat_messages.append({
                    "role": "system",
                    "content": [{"type": "text", "text": sys_text}]
                })

            if messages:
                for m in messages:
                    
                    mm = copy.deepcopy(m) if isinstance(m, dict) else {"role": "user", "content": m}
                    role = mm.get("role", "user")
                    content = mm.get("content", "")

                    normalized = []
                    if isinstance(content, str):
                        normalized = [{"type": "text", "text": content}]
                    elif isinstance(content, dict):
           
                        normalized = [_normalize_content_item(content)]
                    elif isinstance(content, list):
                        for c in content:
                            normalized.append(_normalize_content_item(c))
                    else:
                        normalized = [{"type": "text", "text": str(content)}]

             
                    chat_messages.append({
                        "role": role,
                        "content": normalized
                    })
            else:
                chat_messages.append({
                    "role": "user",
                    "content": [{"type": "text", "text": prompt or ""}]
                })

            

            payload = {
                "model": model or "gpt-4o-mini",
                "messages": chat_messages,
                "temperature": temperature,
            }
            
            if max_tokens:
                payload["max_tokens"] = int(max_tokens)
            if stop:
                payload["stop"] = stop
            if n:
                payload["n"] = int(n)
            if top_p is not None:
                payload["top_p"] = float(top_p)
            if presence_penalty is not None:
                payload["presence_penalty"] = float(presence_penalty)
            if frequency_penalty is not None:
                payload["frequency_penalty"] = float(frequency_penalty)
            if user:
                payload["user"] = user
            if stream:
                payload["stream"] = True
            

    elif provider == "claude":
        url = f"{base_url}{getattr(profile, 'endpoint_chat', '/v1/chat')}"
        if messages:
            payload = {"model": model or getattr(profile, "model", None), "messages": messages}
            if system_prompt:
                # insert system prompt as first message
                payload["messages"] = [{"role": "system", "content": system_prompt}] + payload["messages"]
        else:
            payload = {"model": model or getattr(profile, "model", None), "input": prompt or ""}
            if system_prompt:
                payload["input"] = f"{system_prompt}\n\n{payload['input']}"
        payload["temperature"] = temperature
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        if stop:
            payload["stop"] = stop
        if user:
            payload["user"] = user

    elif provider == "groq":
        url = f"{base_url}{getattr(profile, 'endpoint_chat', '/v1/chat/completions')}"
        payload = {
            "model": model or getattr(profile, "model", None),
            "messages": messages or ([{"role": "user", "content": prompt or ""}]),
            "temperature": temperature,
        }
        if system_prompt:
            payload["messages"] = [{"role": "system", "content": system_prompt}] + payload["messages"]
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        if stop:
            payload["stop"] = stop
        if user:
            payload["user"] = user

    else:
        # Generic fallback: try responses path or chat path depending on messages
        if messages:
            url = f"{base_url}{chat_path}"
            chat_messages = []
            if system_prompt:
                chat_messages.append({"role": "system", "content": system_prompt})
            chat_messages.extend(messages)
            payload = {"model": model, "messages": chat_messages}
        else:
            url = f"{base_url}{responses_path}"
            input_text = prompt or ""
            if system_prompt:
                input_text = f"system: {system_prompt}\n\n{input_text}"
            payload = {"model": model, "input": input_text}
        if max_tokens:
            payload["max_tokens"] = int(max_tokens)
        if stop:
            payload["stop"] = stop
        if user:
            payload["user"] = user

    # merge extra payload (caller can override or extend anything)
    if extra_payload and isinstance(extra_payload, dict):
        payload.update(extra_payload)

    # perform request with retries
    session = requests.Session()
    last_err = None
    for attempt in range(1, retries + 2):
        try:
            frappe.log_error(message=json.dumps({
                                        
                                        "input": {
                                            "url": url,
                                            "headers": headers,
                                            "payload": f"{payload}",
                                            "model": model
                                        }
                                    }, default=str),
                                    title="Post to session to AI"
                                )
            resp = session.post(url, headers=headers, json=payload, timeout=timeout)
            status = resp.status_code
            if 200 <= status < 300:
                try:
                    resp_json = resp.json()
                    frappe.log_error(message=resp_json,title="AI response")
                except ValueError:
                    resp_json = resp.text
                if return_json:
                    return resp_json
                return _parse_response_json(provider, resp_json)
            else:
                last_err = f"HTTP {status}: {resp.text}"
                if 400 <= status < 500:
                    error_json = resp.json()
                    error_message = error_json.get("error", {}).get("message", "")
                    error_code = error_json.get("error", {}).get("code", "")

                    if status == 429 and error_code == "insufficient_quota":
                        frappe.throw("Your AI quota has been exceeded. Please check your subscription or billing details.")
                    else:
                        frappe.throw(f"Provider {getattr(profile, 'service_key', profile.name)} returned {status}: {error_message or resp.text}")
                    # client error -> surface immediately
                # otherwise wait and retry
                time.sleep(1 * attempt)
        except requests.exceptions.RequestException as e:
            last_err = str(e)
            time.sleep(1 * attempt)

    # out of retries
    frappe.throw(f"Failed to call provider '{getattr(profile, 'service_key', profile.name)}'. Last error: {last_err}")



def summarize_channel_if_needed(channel, ai_agent_name):
    
    DEFAULT_MODEL_MAX_TOKENS = 4096
    
    CHUNK_SIZE = 50
    CHUNK_SUMMARY_MAX_TOKENS = 512
    summary_doc = frappe.get_all(
        "ClefinCode Chat Summary",
        filters={"chat_channel": channel},
        limit_page_length=1
    )
  
    try:
        ai_agent = frappe.get_doc(DOC_DOCTYPE,ai_agent_name)
    except Exception:
        frappe.log_error(f"AI Agent Profile not found: {ai_agent_name}", "summarize_channel_if_needed")
        ai_agent = None
   
    
    try:
        model_max_tokens = int(getattr(ai_agent, "max_tokens", None) or getattr(ai_agent, "max_tokens", None) or DEFAULT_MODEL_MAX_TOKENS)
    except Exception:
        model_max_tokens = DEFAULT_MODEL_MAX_TOKENS


    summarization_instructions = ai_agent.summary_prompt or "Summarize concisely keeping facts and actions."

    if summary_doc:
        summary_doc = frappe.get_doc("ClefinCode Chat Summary", summary_doc[0].name)
    else:
        summary_doc = frappe.get_doc({
            "doctype": "ClefinCode Chat Summary",
            "chat_channel": channel,
            "summary_text": "",
            "last_summary_number": 0
        }).insert(ignore_permissions=True)

    since_time = summary_doc.last_summarized_at  #
    # 
    filters = [["chat_channel", "=", channel]]
    if since_time:
        filters.append(["creation", ">", since_time])

    msgs = frappe.get_all(
        "ClefinCode Chat Message",
        filters=filters,
        fields=["name", "sender", "content", "creation"],
        order_by="creation asc",
        limit_page_length=2000
    )
  

    if not msgs:
         return {
            "summary_text": summary_doc.summary_text or "",
            "messages": [],
            "summary_updated": False,
            "last_summarized_message": getattr(summary_doc, "last_summarized_message", None)
        }  

    messages_texts = [
    f"{m['sender']}: {strip_html(m['content'])}" for m in msgs
    ]
    combined_text = "\n".join(messages_texts)

   
    
    total_tokens = estimate_tokens(summary_doc.summary_text or "",ai_agent.model) + estimate_tokens(combined_text) 

    # frappe.log_error(message=f"total_tokens: {total_tokens} model_max_tokens: {model_max_tokens}",title="Total Token")
   
    if total_tokens > model_max_tokens:
       
        chunk_size = ai_agent.summary_batch_size or 5
        while total_tokens > model_max_tokens and len(msgs) > 0:
            chunk = msgs[:chunk_size]
            chunk_text = "\n".join([f"{m['sender']}: {strip_html(m['content'])}" for m in chunk])
            chunk_summary = call_ai_service(
                profile_key=ai_agent_name,
                profile_doctype="ClefinCode AI Agent Profile",
                messages=[{"role":"user",
              "content": (
                        "Update the summary with the new messages, keeping the same language. "
                        "Be concise, avoid repetition, and keep only the essential facts.\n\n"
                        "=== Previous Summary ===\n"
                        f"{summary_doc.summary_text or 'No previous summary'}\n\n"
                        "=== New Messages ===\n"
                        f"{chunk_text}\n\n"
                        "=== Updated Summary ==="
                    )    }],
                system_prompt=summarization_instructions,
                max_tokens=300,
                return_json=False,
                use_responses_endpoint=True
            ) or ""
            # frappe.log_error(message=(
            #             "Update the summary with the new messages, keeping the same language. "
            #             "Be concise, avoid repetition, and keep only the essential facts.\n\n"
            #             "=== Previous Summary ===\n"
            #             f"{summary_doc.summary_text or 'No previous summary'}\n\n"
            #             "=== New Messages ===\n"
            #             f"{chunk_text}\n\n"
            #             "=== Updated Summary ==="
            #         )   ,title="summary content")
        
            summary_doc.summary_text = chunk_summary#(summary_doc.summary_text or "") + "\n" + chunk_summary
            
            msgs = msgs[chunk_size:]
           
            total_tokens = estimate_tokens(summary_doc.summary_text) + sum(estimate_tokens(m["content"]) for m in msgs) 

        if chunk:
            last_handled = chunk[-1]
        else:
            last_handled = msgs[-1] if msgs else None

        if last_handled:
            summary_doc.last_summarized_message = last_handled["name"]
            summary_doc.last_summarized_at = last_handled["creation"]
        messages_texts = [
        f"{m['sender']}: {strip_html(m['content'])}" for m in msgs
        ]
        combined_text = "\n".join(messages_texts)
        summary_doc.last_summary_number = (summary_doc.last_summary_number or 0) + 1
        summary_doc.save(ignore_permissions=True)
        frappe.db.commit()
    elif total_tokens > 0.8 * model_max_tokens:
        # frappe.log_error("Backgorund process must start")
        { frappe.enqueue(
            "clefincode_chat.api.api_1_2_1.ai_agent.summarize_channel_background",
           
            channel=channel,
            ai_agent_name=ai_agent_name,
            queue="long",
            timeout=600
        )}
    return {
            "summary_text": summary_doc.summary_text ,
            "messages": msgs,
            "summary_updated": True,
            "last_summarized_message": getattr(summary_doc, "last_summarized_message", None)
        }


def estimate_tokens(text, model="gpt-3.5-turbo"):
 
    try:
        encoding = tiktoken.encoding_for_model(model)
    except KeyError:
        
        encoding = tiktoken.get_encoding("cl100k_base")

    tokens = encoding.encode(text)
    return len(tokens)

import re

def strip_outer_p_tags(text: str) -> str:
 
    if not text:
        return text

    
    pattern = r'^\s*<p\b[^>]*>(.*?)</p>\s*$'
    m = re.match(pattern, text, flags=re.I | re.S)
    if m:
        return m.group(1)
    return text
def strip_html(text):
    return BeautifulSoup(text, "html.parser").get_text(separator=" ", strip=True)


########################################################
def summarize_channel_background(channel, ai_agent_name):
    
    DEFAULT_MODEL_MAX_TOKENS = 4096
    CHUNK_SUMMARY_MAX_TOKENS = 512

    try:
        summary_doc_list = frappe.get_all(
            "ClefinCode Chat Summary",
            filters={"chat_channel": channel},
            limit_page_length=1
        )
        if summary_doc_list:
            summary_doc = frappe.get_doc("ClefinCode Chat Summary", summary_doc_list[0].name)
        else:
            summary_doc = frappe.get_doc({
                "doctype": "ClefinCode Chat Summary",
                "chat_channel": channel,
                "summary_text": "",
                "last_summary_number": 0
            }).insert(ignore_permissions=True)
    except Exception as e:
        frappe.log_error(f"Error fetching/creating summary doc: {str(e)}", "summarize_channel_background")
        return

    try:
        ai_agent = frappe.get_doc("ClefinCode AI Agent Profile", ai_agent_name)
    except Exception:
        frappe.log_error(f"AI Agent Profile not found: {ai_agent_name}", "summarize_channel_background")
        return

    summarization_instructions = ai_agent.summary_prompt or "Summarize concisely keeping facts and actions."
    chunk_size = ai_agent.summary_batch_size or 5
    model_max_tokens = ai_agent.max_tokens or DEFAULT_MODEL_MAX_TOKENS

    since_time = summary_doc.last_summarized_at
    filters = [["chat_channel", "=", channel]]
    if since_time:
        filters.append(["creation", ">", since_time])

    try:
        msgs = frappe.get_all(
            "ClefinCode Chat Message",
            filters=filters,
            fields=["name", "sender", "content", "creation"],
            order_by="creation asc",
            limit_page_length=2000
        )
    except Exception as e:
        frappe.log_error(f"Error fetching messages: {str(e)}", "summarize_channel_background")
        return

    if not msgs:
        return

    try:
        total_tokens = estimate_tokens(summary_doc.summary_text or "", ai_agent.model) \
                       + sum(estimate_tokens(m["content"]) for m in msgs)

        while msgs and total_tokens > 0.5 * model_max_tokens:
            chunk = msgs[:chunk_size]
            chunk_text = "\n".join([f"{m['sender']}: {strip_html(m['content'])}" for m in chunk])

            try:
                chunk_summary = call_ai_service(
                    profile_key=ai_agent_name,
                    profile_doctype="ClefinCode AI Agent Profile",
                    messages=[{
                        "role": "user",
                         "content": (
                        "Update the summary with the new messages, keeping the same language. "
                        "Be concise, avoid repetition, and keep only the essential facts.\n\n"
                        "=== Previous Summary ===\n"
                        f"{summary_doc.summary_text or 'No previous summary'}\n\n"
                        "=== New Messages ===\n"
                        f"{chunk_text}\n\n"
                        "=== Updated Summary ==="
                    )    }],
                 
                    system_prompt=summarization_instructions,
                    max_tokens=CHUNK_SUMMARY_MAX_TOKENS,
                    return_json=False,
                    use_responses_endpoint=True
                ) or ""
            except Exception as e:
                frappe.log_error(f"Error calling AI service: {str(e)}", "summarize_channel_background")
                chunk_summary = ""

            summary_doc.summary_text = chunk_summary
            msgs = msgs[chunk_size:]

            total_tokens = estimate_tokens(summary_doc.summary_text or "", ai_agent.model) \
                           + sum(estimate_tokens(m["content"]) for m in msgs)

     
        last_handled = chunk[-1] if chunk else msgs[-1] if msgs else None
        if last_handled:
            summary_doc.last_summarized_message = last_handled["name"]
            summary_doc.last_summarized_at = last_handled["creation"]

        summary_doc.last_summary_number = (summary_doc.last_summary_number or 0) + 1
        summary_doc.save(ignore_permissions=True)
        frappe.db.commit()

    except Exception as e:
        frappe.log_error(f"Error during summarization loop: {str(e)}", "summarize_channel_background")

def linkify_and_detect(text: str):
 
    if text is None:
        return ("", False)

    
    has_link = bool(URL_PATTERN.search(text))

   
    def _repl(match):
        url = match.group(1)
        href = url
     
        if href.lower().startswith("www."):
            href = "https://" + href
        return f'<a href="{href}" target="_blank" rel="noopener noreferrer">{url}</a>'

    linked = URL_PATTERN.sub(_repl, text)
    return (linked, has_link)