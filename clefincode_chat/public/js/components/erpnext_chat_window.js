export default class ChatWindow {
    constructor(opts) {        
        this.$wrapper = $('.chat-app .chat_left_section');
        this.profile = opts.profile;
        this.setup();        
    }

    setup() {        
        this.$chat_window = $(document.createElement('div'));
        this.$chat_window.addClass('chat-window');
        if(this.profile.contact){
            this.$chat_window.attr('data-contact' , this.profile.contact);
        }else if(this.profile.room){
            this.$chat_window.attr('data-room' , this.profile.room);
        }else if(this.profile.chat_topic){
            this.$chat_window.attr('data-topic' , this.profile.chat_topic);
        }      
        this.$wrapper.css('display' , '');
        this.$wrapper.append(this.$chat_window);
    }
    
}