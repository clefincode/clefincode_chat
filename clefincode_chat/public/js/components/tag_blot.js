import {
    scroll_to_bottom ,
    convertToUTC,
    send_message,
    create_sub_channel
  } from './erpnext_chat_utils';

export default class TagBlot {
    constructor(opts) {
        this.$wrapper = opts.$wrapper;
        this.profile = opts.profile;
        this.chat_space = this.profile.chat_space
        this.setup();
        this.setup_events();    
    }

    setup(){
        this.$tag_blot = $(document.createElement("div"))
        .addClass("tag-blot")
        .attr("data-email" , this.profile.contributor_email);
        this.$tag_blot.append(`<span style="white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;">${this.profile.contributor_name}</span>`);

        if(this.chat_space.profile.room_type != "Contributor"){ 
            this.$close_btn = $(document.createElement("span"));
            this.$close_btn.append(frappe.utils.icon('close' , 'sm'));
            this.$close_btn.addClass("remove-tag");
            this.$tag_blot.append(this.$close_btn);
        }        
        this.$wrapper.append(this.$tag_blot);
        if(this.chat_space.profile.room_type == "Direct"){
            if(this.chat_space.$chat_space.hasClass("delete-sender-name")){
                this.chat_space.$chat_space.removeClass('delete-sender-name');
            }
        }
    }

    setup_events(){
        const me = this;
        if(this.chat_space.profile.room_type != "Contributor"){
            me.$close_btn.on('click', function () {
                if(me.close_click != undefined){ 
                    clearTimeout(me.close_click);
                    me.close_click = undefined;
                }
                me.close_click = setTimeout(() => {
                    let user_to_remove = $(this).parent('.tag-blot').data("email");            
                    let empty_contributor_list = 1
                    me.chat_space.contributors = me.chat_space.contributors.filter(user => user.email !== user_to_remove);
                    if(me.chat_space.contributors.length > 0){
                        empty_contributor_list = 0
                    }

                    me.create_sub_channel(me.chat_space.contributors , me.chat_space.profile.room , me.chat_space.profile.user , me.chat_space.profile.user_email , user_to_remove , empty_contributor_list , me.chat_space.last_active_sub_channel);  
                    $(this).parent('.tag-blot').remove();
                    if(me.$wrapper.find('.tag-blot').length == 0){
                        me.$wrapper.parent('.tag-section').remove();
                        if(me.chat_space.profile.room_type == "Direct"){
                            me.chat_space.$chat_space.addClass('delete-sender-name');
                          }
                    }
                }, 300); 
                    
            });
        }        
    }

    async create_sub_channel(contributors , room , user , user_email  , user_to_remove , empty_contributor_list , last_active_sub_channel){
        let mention_msg = `
        <div class="remove-user" data-template="remove_user_template">
        <span class="sender-user" data-user="${this.chat_space.profile.user_email}"></span><span> removed </span><span class="receiver-user" data-user="${this.profile.contributor_email}"></span>
        </div>`;

    //   this.chat_space.$chat_space_container.append(
    //     await this.chat_space.make_message({
    //         content: mention_msg,
    //         type: "info-message",
    //         sender: this.chat_space.profile.user,
    //         message_template_type: "Remove User"
    //     }));

        const utc_send_date = convertToUTC(frappe.datetime.now_datetime() , this.chat_space.profile.time_zone)

        const message_info = {
            content: mention_msg,
            user: this.chat_space.profile.user,
            room : this.chat_space.profile.room,
            email : this.chat_space.profile.user_email,
            sub_channel: this.chat_space.last_active_sub_channel,
            message_type: "information",
            message_template_type : "Remove User",
            send_date: utc_send_date,
            chat_topic: this.chat_space.chat_topic
        }

        await send_message(message_info);

        this.chat_space.last_active_sub_channel = await create_sub_channel({
            new_contributors: contributors,
            parent_channel: room,
            user: user,
            user_email: user_email,
            creation_date: utc_send_date,
            last_active_sub_channel: last_active_sub_channel,
            user_to_remove: user_to_remove,
            empty_contributor_list: empty_contributor_list,
            freeze: true
        })
        scroll_to_bottom(this.chat_space.$chat_space_container)
    }
     
} // END Class


