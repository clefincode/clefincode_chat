import frappe
from frappe.model.document import Document
from clefincode_chat.api.api_1_2_1 import api,ai_agent
from clefincode_chat.api.api_1_2_1.ai_agent import call_ai_service,summarize_channel_if_needed,strip_html

from openai import OpenAI
import json



def process_ai_reply_job(chat_message_name):
   
  
    try:
        msg = frappe.get_doc("ClefinCode Chat Message", chat_message_name)
        if msg.message_type=="information":
            return
        # تجاهل إذا المرسل بوت
        try:

            sender_profile = frappe.get_doc("ClefinCode Chat Profile", msg.sender)
            if sender_profile.is_ai_bot:
                return
            if msg.is_mention:
                return
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Error getting sender profile")
            return

        # اجلب القناة و أعضائها/المساهمين
        try:
            channel = frappe.get_doc("ClefinCode Chat Channel", msg.chat_channel)
        except Exception:
            frappe.log_error(f"Chat Channel not found: {msg.chat_channel}", "process_ai_reply_job")
            return

        participants = []
        if hasattr(channel, "members"):
            participants.extend(channel.members)
        if hasattr(channel, "contributors"):
             active_contributors = []
             for c in (channel.contributors or []):
                try:
                    is_active = False

                    if hasattr(c, "active"):
                        is_active = bool(getattr(c, "active"))
                    if is_active:
                          active_contributors.append(c)
                except Exception:
                      frappe.log_error(frappe.get_traceback(), "filter contributors - loop error")
             participants.extend(active_contributors)
        print(channel.contributors)
        for p in participants:
            try:
                if not getattr(p, "profile_id", None):
                    continue
                print(p.profile_id)
                profile = frappe.get_doc("ClefinCode Chat Profile", p.profile_id)

                if profile.is_ai_bot:
                    if not profile.ai_agent_profile:
                        frappe.log_error(
                            f"AI bot profile {profile.name} does not have ai_agent_profile linked.",
                            "AI Bot Missing Agent Profile"
                        )
                        continue

                    ai_agent = frappe.get_doc("ClefinCode AI Agent Profile", profile.ai_agent_profile)
                   
                    system_prompt = profile.instruction#getattr(ai_agent, "summary_prompt", None) or None
                    model = getattr(ai_agent, "model", None) or None
                    temperature = getattr(ai_agent, "temperature", None)
                    max_tokens = getattr(ai_agent, "max_tokens", None)
                    summary_result =summarize_channel_if_needed(channel.name, ai_agent.name)
                    messages = []
                    # print("summary_result")
                    # print(summary_result)
                    # print("summary_result")

                    
                    
                    if isinstance(summary_result, dict):
                        summary_text = summary_result.get("summary_text", "") or ""
                        remaining_msgs = summary_result.get("messages", []) or []
                        
                        # print("remaining_msgs")
                        # print(remaining_msgs)
                        # print("remaining_msgs")
                        if summary_text:
                            summary_message = (
                                    "You are an intelligent assistant. "
                                    "The following text is only a summary of the previous conversation. "
                                    "Use it as a reference to answer the user's new questions, "
                                    "and do not re-summarize or rephrase it.\n\n"
                                    f"Conversation summary (past):\n{summary_text}"
                                )
                            messages.append({"role": "system", "content": summary_message})

                        for m in remaining_msgs:
                            # بسيطة: إذا كان مرسل الرسالة لديه profile وهو بوت، نضع assistant، وإلا user
                            role = "user"
                            try:
                                if m.get("sender"):
                                    prof = frappe.get_all("ClefinCode Chat Profile", filters=[["name", "=", m.get("sender")]], fields=["is_ai_bot"], limit_page_length=1)
                                    if prof and prof[0].get("is_ai_bot"):
                                        role = "assistant"
                            except Exception:
                                role = "user"
                            messages.append({"role": role, "content": f"{m['sender']} says: {strip_html(m['content'])}" or ""})
                   # messages.append({"role": "user", "content": strip_html(msg.content) or ""})
                  
                    try:
                        frappe.log_error(
                                    message=json.dumps({
                                        
                                        "input": {
                                            "profile_key": ai_agent.name,
                                            "messages": [messages],
                                            "system_prompt": system_prompt,
                                            "model": model,
                                            "temperature": temperature,
                                            "max_tokens": max_tokens
                                        }
                                    }, default=str),
                                    title="AI Service Call  Input"
                                )
                        reply = call_ai_service(
                            profile_key=ai_agent.name,
                            profile_doctype="ClefinCode AI Agent Profile",
                            messages=[messages],
                            system_prompt=system_prompt,
                            model=model,
                            temperature=float(temperature) if temperature is not None else None,
                            max_tokens=int(max_tokens) if max_tokens else None,
                            return_json=False,
                            use_responses_endpoint=False
                        )
                    except Exception:
                        frappe.log_error(frappe.get_traceback(), "call_ai_service Error")
                        continue

                    if reply:
                        
                        try:
                            api.send(
                                content=f"<p>{reply}</p>",
                                user=p.profile_id,
                                room=msg.chat_channel,
                                email=p.user,
                                is_first_message=0,
                                is_screenshot=0
                            )
                        except Exception as e:
                            frappe.log_error(title="API send error", message=str(e))

            except Exception:
                frappe.log_error(frappe.get_traceback(), "process_ai_reply_job - participant loop error")

    except Exception:
        frappe.log_error(frappe.get_traceback(), "process_ai_reply_job Error")


class ClefinCodeChatMessage(Document):
    def after_insert(self):
        pass
        # try:
        # #    ������������������������������������ ������������������������������������ ������������������������������������ (dotted path) ������������������������������������ ������������������������������
        #     # frappe.enqueue(
        #     #     method="clefincode_chat.clefincode_chat.doctype.clefincode_chat_message.clefincode_chat_message.process_ai_reply_job",
        #     #     queue="short",
        #     #     timeout=600,
        #     #     chat_message_name=self.name
        #     # )
        #    # process_ai_reply_job(self.name)
        #     # print(self.name)
        # except Exception:
        #     frappe.log_error(frappe.get_traceback(), "after_insert enqueue Error")

