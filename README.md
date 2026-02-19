<p align="center">

<img src="screenshots/clefincode_chat_logo.png" alt="ClefinCode Chat logo" width="50%"/>

<h3 align="center">ClefinCode Chat</h3>
  <p align="center">Enhance business communication with multimedia messaging and ERPNext integration.
    <br />
    <br />
    <a href="https://clefincode.com/pages/clefincode_chat_docs"><strong>Learn More »</strong></a>
     <br />   
    <br />
    <a href="https://github.com/clefincode/clefincode_chat/issues">Issues</a>
    ·
    <a href="https://github.com/clefincode/clefincode_chat/discussions">Discussions</a>
  </p>
</p>
<br>
Welcome to ClefinCode, where innovation meets digital transformation. We’re proud to introduce ClefinCode Chat, a groundbreaking solution designed to revolutionize the way businesses communicate. Our expertise in web and mobile application development has led us to create a platform that enhances, secures, and streamlines communication across your organization, ensuring that your business stays ahead in today’s digital world.

Comprehensive Communication Solution: ClefinCode Chat offers a full suite of multimedia messaging capabilities, allowing your team to share pictures, videos, files, and voice clips effortlessly. With an intuitive interface, our chat application facilitates easy adoption, enabling direct messaging or group conversations without the complexity.

Advanced Features for Business Efficiency: Our application supports dynamic participation in conversations, topic-integrated discussions, and guest messaging via a website support portal, ensuring that your communication is both efficient and comprehensive. Manage privacy and collaboration within your organization with ease, fostering a secure and productive environment.

Access Anywhere, Anytime: ClefinCode Chat is a free mobile app available for download from Google Play. This ensures that you and your team can stay connected, whether on the go or at the office.

Open Source and Customizable: Behind ClefinCode Chat is the powerful [ERPNext system](https://erpnext.com), supported by the open-source [Frappe application](https://frappeframework.com). You can download the backend code from GitHub and install it on your own server. This flexibility allows you to customize your ERPNext instance to suit your specific business needs, seamlessly integrating with both our web and mobile applications.

Dedicated Support: Our support section within the app is designed to assist you whenever you need information, help with an issue, or have questions about our ERPNext services and mobile application development. We are here to ensure that your experience with ClefinCode Chat and ERPNext is nothing short of exceptional.

<img width="1402"  src="screenshots/web/dark_main_screen.png">

<details>
  <summary>Show more screenshots</summary>

  <img width="1402" src="screenshots/web/start_direct_chat.gif">
  <br>
  <br>
  <img width="1402" src="screenshots/web/create_group.gif">
  <br>
  <br>
  <img width="1402" src="screenshots/web/add_contributor.gif">
  <br>
  <br>
  <img width="1402" src="screenshots/web/set_topic.gif">
  <br>
  <br>
  <img width="1402" src="screenshots/web/group_details.gif">
  <br>
  <br>
</details>

<hr>

## Features

## 🌐 Comprehensive Communication Solution

- 💬 **Direct & Group Messaging**: Smooth engagement in one-on-one or group chats.
- 🖼 **Multimedia Messaging**: Share pictures, videos, files, and voice clips effortlessly.
- 📱 **Intuitive Interface**: An easy-to-use application for quick adoption.

## 🚀 Advanced Features for Business Efficiency

- 🔄 **User / Doctype Mentions**: Flexibly join and contribute to conversations and topic-integrated discussions.
- 🌟 **Guest Messaging**: Enhance customer service with a website support portal.
- 📲 **WhatsApp Business API Integration**: Manage WhatsApp conversations directly within your ERP, centralizing and organizing interactions for invoices, projects, and day-to-day communications.

## 🌍 Access Anywhere, Anytime

- 📲 **Mobile App Availability**: Free to download from [Google Play](https://play.google.com/store/apps/details?id=com.clefincode.chat&hl=en&gl=US) and [App Store](https://apps.apple.com/ae/app/clefincode-chat/id6478499855), keeping you connected whether on the go or at the office.
    <details>
    
    <summary>Show mobile screenshots</summary>
    <img width="300" src="screenshots/mobile/set_domain.jpeg">
    <br>
    <br>
    <img width="300" src="screenshots/mobile/login.jpeg">
    <br>
    <br>
    <img width="300" src="screenshots/mobile/channel_list.jpeg">
    <br>
    <br>
    <img width="300" src="screenshots/mobile/add_contributor.gif">
    <br>
    <br>
    <img width="300" src="screenshots/mobile/set_topic.gif">
    <br>
    <br>
    <img width="300" src="screenshots/mobile/share_documents.jpeg">
    <br>
    <br>
    <img width="300" src="screenshots/mobile/request_support.jpeg">
    <br>
    <br>
    </details>

## 💻 Open Source and Customizable

- 🛠 **Powered by ERPNext & Frappe**: Utilize the flexibility of open-source to customize your experience.
- 🔄 **Seamless Integration**: Seamlessly integrate with our web and mobile applications to suit specific business needs.

## 🤝 Dedicated Support

- 🆘 **In-App Support Section**: Get instant assistance, information, and answers to your ERPNext and mobile app development queries.
- 🌟 **Exceptional Experience**: We're here to ensure your experience with ClefinCode Chat is nothing short of exceptional.

## Built with

ClefinCode Chat is built using the [Frappe Framework](https://frappeframework.com) - an open-source full stack development framework.

These are some of the tools it's built on:

- [Python](https://www.python.org)
- [Redis](https://redis.io/)
- [MariaDB](https://mariadb.org/)
- [Socket.io](https://socket.io/)

The mobile app is built using [Flutter](https://flutter.dev/)
<br>

## Installation

Since ClefinCode Chat is a Frappe app, it can be installed via [frappe-bench](https://frappeframework.com/docs/v14/user/en/bench) on your local machine or on your production site.

Once you have setup your bench and your site, you can install the app via the following commands:

```bash
bench get-app https://github.com/clefincode/clefincode_chat.git
bench --site yoursite.name install-app clefincode_chat
bench --site yoursite.name migrate
bench build
```

**Note:** If migrating from version < 1.3.0 to > 1.3.0, run the following command before migrate:

```bash
bench setup requirements
```
## Getting Started with WhatsApp in ERPNext

You'll first need to set up developer assets and obtain credentials from the Meta Developer Portal. Follow this guide to get started: 
[Meta Developer Portal Guide](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started#set-up-developer-assets)

### 1. Enter WhatsApp Credentials

<img width="1402" src="screenshots/web/Whatsapp_credentials.png">

### 2. Set Up the WhatsApp Profile

<img width="1402" src="screenshots/web/whatsapp_profile.png">

**Important Tips:**

- When entering the WhatsApp number, do not include `00` or `+`. Start directly with the country code and the number, e.g., `971xxxxxxxxx`.
  
- There are two types of WhatsApp profiles you can create:
  
  1. **Personal** 👤: Opens a direct communication channel between the sender and the receiver.
  2. **Support** 👥: Opens a group channel between the sender and receiver, allowing the admin to add or remove other members from the channel.

- After saving the WhatsApp profile, a WhatsApp template will be automatically created.

<img width="1402" src="screenshots/web/save_whatsapp_profile.png">
<img width="1402" src="screenshots/web/whatsapp_template.png">

🎉Now, you can begin sending and receiving WhatsApp messages directly using our chat app within your ERP system🎉

<img width="1402" src="screenshots/web/send_message.png">  
Twilio WhatsApp Integration

Connect WhatsApp through Twilio to manage inbound and outbound messages directly inside ERPNext.

1. Enter Twilio Credentials

Add your Twilio credentials:

Twilio Account SID

Auth Token

<img width="1402" src="screenshots/web/twilio_setting.png">
2. Create a Twilio WhatsApp Profile

Select the WhatsApp-enabled number from Twilio

Select Provider: Twilio

Choose a Type (Personal or Support) and save

Important tip: A template will be created automatically and its preview will be visible.

<img width="1402" src="screenshots/web/whatapp_profile.gif">
3. Test WhatsApp Messaging
Test Sent Messages

Text

Image

Voice note

<img width="1402" src="screenshots/web/test_messages.gif">
Test Received Messages

Text

Image

Voice note

Location

Contact

<img width="1402" src="screenshots/web/receive_messages.gif">
Twilio Templates

Create message templates, submit them for approval, then send them from chat using /.

Create Twilio Text Template

Enter Friendly Name

Select Template Type: twilio/text

Select Category

Select Language

Write message in Body

Save, submit, and wait for approval

<img width="1402" src="screenshots/web/create_text_template.gif">

Important tips (Meta/WhatsApp template name rules)

Allowed characters: lowercase alphanumeric only (a-z, 0-9)

Allowed separator: underscore _ only

No spaces

No special characters (! @ # $ % - . etc.)

Use meaningful names (example: order_delivery)

Name should be unique for your account if template content is unique

Create Twilio Media Template

- Enter Friendly Name

- Select Template Type: twilio/media

- Select Category

- Select Language

- Write message in Body

- Add media link in Media URL

- Save, submit, and wait for approval

<img width="1402" src="screenshots/web/create_image_template.gif">
Create Quick Reply Template

- Enter Friendly Name

- Select Template Type: quick-replay

- Write message in Body

- Add button and value in actions table

- Save, submit, and wait for approval

<img width="1402" src="screenshots/web/create_quick_replay_template.gif">
Create List Picker Template

Enter Friendly Name

Select Template Type: list-picker

Write message in Body

Add list items in Items table

Save, submit, and wait for approval

<img width="1402" src="screenshots/web/create_list_picker_template.gif">
Use Variables

Twilio uses variables in content templates to personalize messages. Variables follow the {{...}} syntax and are populated with dynamic data when the message is sent.

You can map variables to fields from the associated DocType by filling the variable table.

<img width="1402" src="screenshots/web/varible_with_template.gif">

Important tips

Variables must be sequential: {{1}}, {{2}}, {{3}}

Variables should not be adjacent

Variables should not start or end the message

Must have enough text: (2x + 1) non-variable words per x variables

Avoid too many variables in short messages

Add Variable to Media Template

Set base URL of your site

Select field with attached file

Add default value

<img width="1402" src="screenshots/web/varible_with_media.gif">
Attach DocType Print to Template

To send the connected DocType print:

- Use a Media Template and add a variable (as above)

- No need to add a DocType field, but default value is required

- Enable Attach Document Print

- Select Print Format

- Select Language Format: English

- Select Letter Head

<img width="1402" src="screenshots/web/attached_print.png">

Send Template from Chat

- Open Chat

- Type / and wait for approved templates

- Select a template

- If linked to a DocType, choose the required document

<img width="1402" src="screenshots/web/test_sent_template.gif">

## Manage Contacts

Add and manage contacts directly from the chat interface, including multiple identifiers per contact.

### Manage Contacts (Admin)

- Click the **Chat** icon.
- Click the **+** button.
- Select **Add Contact** to create a new contact.
- Admins can edit contacts using **Manage Contact**.
- Update contact details in the popup window.
- If an identifier already exists, the system will show an error.

<img width="1402" src="screenshots/web/manage_contact.gif">

### ClefinCode Chat Profile

A **Chat Profile** centralizes all identifiers for a person/company (WhatsApp, Telegram, Instagram, Messenger, etc.) and maps them to a system user.

- Create a **Chat Profile** and set its name.
- Assign a **System User** (email).
- Add one or more contact identifiers (WhatsApp / Telegram / Instagram / Messenger).
- The profile keeps all identifiers organized in one place.

<img width="1402" src="screenshots/web/add_contact.gif">


## 🖥 Web UI Features

Powerful and intuitive message controls designed to enhance productivity and keep conversations structured inside ERPNext.

### ↩️ Reply to Messages
To reply to a specific message:
1. Click directly on the message bubble.
2. Select **Reply**.
3. Type your response and send.

Your reply will remain linked to the original message to preserve context and make conversations easier to follow.

<img width="1402" src="screenshots/web/reply_message.gif">

**GIF Link:** screenshots/web/reply_message.gif

---

### 🔁 Forward Messages
To forward a message:
1. Click on the message bubble.
2. Select **Forward**.
3. Choose the contact or channel you want to forward the message to.
4. You can select **multiple recipients at the same time**.
5. Confirm to send.

Forwarded messages are clearly labeled for transparency.

<img width="1402" src="screenshots/web/forward_message.gif">

**GIF Link:** screenshots/web/forward_message.gif

---

### ✏️ Edit Sent Messages
To edit a message:
1. Click on the message bubble.
2. Select **Edit**.
3. Update the message content.
4. Save the changes.

⚠️ Editing is only allowed within **7 minutes** of sending the message.  
This duration can be modified from the **Chat Settings**.

<img width="1402" src="screenshots/web/edit_message.gif">

**GIF Link:** screenshots/web/edit_message.gif

---

### 🗑 Delete Messages
To delete a message:
1. Click on the message bubble.
2. Select **Delete**.
3. Confirm the deletion.

⚠️ **Important:**  
Messages cannot be edited or deleted after **7 minutes** from the time they were sent.  
The time limit can be customized from the **Chat Settings**.

<img width="1402" src="screenshots/web/delete_message.gif">

**GIF Link:** screenshots/web/delete_message.gif

---

### 😀 Message Reactions
To react to a message:
1. Press and hold (long press) on the message bubble.
2. Select the desired emoji reaction.

You can:
- Remove a reaction by clicking the same emoji again.
- Change your reaction by selecting a different emoji.

Reactions help reduce unnecessary replies and improve collaboration speed.

<img width="1402" src="screenshots/web/reactions.gif">

**GIF Link:** screenshots/web/reactions.gif

---

### 🔎 In-Chat Search
1. Open the desired chat (contact or channel).
2. Click on the top area of the conversation (chat header).
3. The chat details interface will open.
4. Click on the **Search icon**.
5. Enter the keyword you want to find.
6. Navigate through the results to locate the exact message.

This allows you to quickly find important details, decisions, or shared information.

<img width="1402" src="screenshots/web/search.gif">

**GIF Link:** screenshots/web/search.gif


## Reporting Bugs

If you find any bugs, feel free to report them here on [GitHub Issues](https://github.com/clefincode/clefincode_chat/issues).

## License

GNU General Public License (v3)