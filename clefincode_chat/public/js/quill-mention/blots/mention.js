/* eslint-disable */
import Quill from "quill";
import {check_if_contact_has_chat} from '../../components/erpnext_chat_contact';
import {check_if_chat_window_open} from '../../components/erpnext_chat_utils';
import ChatWindow from "../../components/erpnext_chat_window";
import ChatSpace from "../../components/erpnext_chat_space";

const Embed = Quill.import("blots/embed");

class MentionBlot extends Embed {
	static create(data) {
		const node = super.create();
		const denotationChar = document.createElement("span");
		denotationChar.className = "ql-mention-denotation-char";
		denotationChar.innerHTML = data.denotationChar;
		node.appendChild(denotationChar);
		node.innerHTML += data.value;
		node.innerHTML += `${data.isGroup === "true" ? frappe.utils.icon("users") : ""}`;
		node.dataset.id = data.id;
		node.dataset.name = data.name;
		node.dataset.value = data.value;
		node.dataset.isDoctype = data.is_doctype?data.is_doctype : 0;
		node.dataset.denotationChar = data.denotationChar;
		node.dataset.isGroup = data.isGroup;
		if (data.doctype) {
			node.dataset.doctype = data.doctype;
		}
		node.dataset.link = data.link;

		node.style.cursor = "pointer";
		$(node).on("click" , function(){
			if($(this).data("id") == frappe.session.user || $(this).data("is-doctype") == 1){
				return;
			  }
			check_contact_has_chat(frappe.session.user , $(this).data("id") , $(this).data("name") , "Chat");
		})	
		
		return node;
	}

	static value(domNode) {
		return {
			id: domNode.dataset.id,
			name: domNode.dataset.name,
			value: domNode.dataset.value,
			is_doctype: domNode.dataset.isDoctype,
			doctype: domNode.dataset.doctype,
			link: domNode.dataset.link || null,
			denotationChar: domNode.dataset.denotationChar,
			isGroup: domNode.dataset.isGroup,
		};
	}

	
	  
	  
}//End Class


MentionBlot.blotName = "mention";
MentionBlot.tagName = "span";
MentionBlot.className = "mention";

Quill.register(MentionBlot, true);

async function check_contact_has_chat(user_email , contact , contact_name , platform){
	const room = await check_if_contact_has_chat(user_email , contact , platform);
	if(room.results.name){     
	  open_chat_space(room.results.user, contact , contact_name , platform , room.results.name);
  
	}else{
	  open_chat_space(room.results.user, contact , contact_name, platform); 
	}  
}

function open_chat_space(user , contact , contact_name, platform , room = null){
	if(room){
	  if (check_if_chat_window_open(room , "room")){
		$(".expand-chat-window[data-id|='"+room+"']").click();
		return
	  }       
	  
	  let chat_window = new ChatWindow({
		profile: {
		  room : room
		}
	  });
  
	  let profile = {
		is_admin: true,
		user: user,
		user_email: frappe.session.user,
		room: room,
		room_name: contact_name,        
		room_type: "Direct",        
		contact: contact,
		is_first_message : 0,
		platform : platform
	  };
  
	  new ChatSpace({
		$wrapper: chat_window.$chat_window,
		profile: profile,
	  });
	}else{
	  if (check_if_chat_window_open(contact , "contact")){
		$(".expand-chat-window[data-id|='"+contact+"']").click();
		return
	  }       
	  
	  let chat_window = new ChatWindow({
		profile: {
		  contact : contact
		}
	  });
  
	  let profile = {
		is_admin: true,
		user: user,
		user_email: frappe.session.user,
		room: null,
		room_name: contact_name,        
		room_type: "Direct",        
		contact: contact,
		is_first_message : 1,
		platform : platform
	  };
  
	  new ChatSpace({
		$wrapper: chat_window.$chat_window,
		profile: profile,
	  });
	}
}

