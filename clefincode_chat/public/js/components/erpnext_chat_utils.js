const moment1 = require("moment-timezone");

function get_current_datetime() {
  let current_time = moment1();
  return current_time.format("YYYY-MM-DD HH:mm:ss");
}

function get_current_time() {
  let current_time = moment1();
  return current_time.format("h:mm A");
}

function get_t(dateString) {
  let current_time = moment1(dateString);
  return current_time.format("h:mm A");
}

function get_time(dateString, time_zone = null) {
  const momentObj = moment1.tz(dateString, time_zone).format("hh:mm A");
  return momentObj;
}

function convertToUTC(dateString, timezone) {
  return moment1.tz(dateString, timezone).utc().format("YYYY-MM-DD HH:mm:ss");
}

function get_date_from_now(dateObj, type, time_zone) {
  const sameDay = type === "space" ? "[Today]" : "h:mm A";
  const elseDay = type === "space" ? "MMM D, YYYY" : "DD/MM/YYYY";
  const result = moment1.tz(dateObj, time_zone).calendar(null, {
    sameDay: sameDay,
    lastDay: "[Yesterday]",
    lastWeek: elseDay,
    sameElse: elseDay,
  });
  return result;
}

function is_date_change(dateObj, prevObj, time_zone) {
  const curDate = moment1.tz(dateObj, time_zone).format("DD/MM/YYYY");
  const prevDate = moment1.tz(prevObj, time_zone).format("DD/MM/YYYY");
  return curDate !== prevDate;
}

function scroll_to_bottom($element) {
  const container = $element;
  container.scrollTop(container.prop("scrollHeight"));
}

function scroll_to_message(element) {
  // element.css('background-color' , 'rgba(0,0,100,0.1)')
  $(".bg-message").removeClass("bg-message");
  element.addClass("bg-message");
  $(".chat-space-container").animate(
    {
      scrollTop: element.offset().top,
    },
    300
  );
}

function is_image(filename) {
  const allowedExtensions =
    /(\.jpg|\.jpeg|\.png|\.gif|\.webp|\.svg|\.avif|\.jfif)$/i;
  if (!allowedExtensions.exec(filename)) {
    return false;
  }
  return true;
}

function is_video(filename) {
  const allowedExtensions =
    /(\.mp4|\.m4v|\.mkv|\.flv|\.avi|\.mvi|\.amv|\.mov)$/i;
  if (!allowedExtensions.exec(filename)) {
    return false;
  }
  return true;
}

function is_audio(filename) {
  var fileExtension = filename.split(".").pop().toLowerCase();
  var audioExtensions = ["mp3", "oga", "ogg"];

  return audioExtensions.includes(fileExtension);
}

function is_document(filename) {
  const allowedExtensions =
    /(\.doc|\.docx|\.pdf|\.txt|\.xls|\.xlsx|\.csv|\.zip|\.rar|\.pptx|\.ppt|\.ppsx)$/i;
  if (!allowedExtensions.exec(filename)) {
    return false;
  }
  return true;
}

function is_voice_clip(filename) {
  const allowedExtensions = /(\.aac)$/i;
  if (!allowedExtensions.exec(filename)) {
    return false;
  }
  return true;
}

function is_email(value) {
  var pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return pattern.test(value);
}

function is_phone_number(value) {
  var pattern = /^\+?[\d\s-]+$/;
  return pattern.test(value);
}

function mark_messsages_as_read(user, channel = null, parent_channel = null) {
  frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.mark_messsages_as_read",
    args: {
      user: user,
      channel: channel,
      parent_channel: parent_channel,
    },
  });
}

async function set_user_settings(settings) {
  await frappe.call({
    method: "chat.api.config.user_settings",
    args: {
      settings: settings,
    },
  });
}

function get_avatar_html(room_name, room_type = "") {
  if (room_type == "Group") {
    let color = frappe.get_palette("G");
    style = `background-color: var(${color[0]}); color: var(${color[1]}); display:flex`;

    return `<span class="avatar avatar-medium">
    <div class="fa fa-users avatar-frame standard-image"
      style="${style}">
    </div>
  </span>`;
  }
  if (room_type == "Contributor") {
    return frappe.get_avatar("avatar-medium", "@");
  } else {
    return frappe.get_avatar("avatar-medium", room_name);
  }
}

function set_notification_count(type) {
  const current_count = frappe.ErpnextChat.settings.unread_count;
  if (type === "increment") {
    $("#chat-notification-count").text(current_count + 1);
    frappe.ErpnextChat.settings.unread_count += 1;
  } else {
    if (current_count - 1 === 0) {
      $("#chat-notification-count").text("");
    } else {
      $("#chat-notification-count").text(current_count - 1);
    }
    frappe.ErpnextChat.settings.unread_count -= 1;
  }
}

function check_if_chat_window_open(element, data) {
  let open_chat_windows = $(".chat-window");
  let open_window_exist = false;
  if (open_chat_windows.length > 0) {
    open_chat_windows.each(function () {
      let open_chat_window = $(this).data(data);
      if (element == open_chat_window) {
        open_window_exist = true;
      }
    });
  }
  if (open_window_exist) {
    return true;
  }
}

function contains_arabic(text) {
  var arabicPattern =
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/;
  if (arabicPattern.test(text)) {
    return true;
  } else {
    return false;
  }
}

async function get_profile_full_name(user_email) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_profile_full_name",
    args: {
      user_email: user_email,
    },
  });
  return await res.message;
}

function get_user_names(users_list) {
  const uniqueNamesSet = new Set(users_list.map((user) => user.name));
  const added_members_name = Array.from(uniqueNamesSet).join(", ");
  return added_members_name;
}

function get_user_emails(users_list) {
  const uniqueEmailsSet = new Set(users_list.map((user) => user.email));
  const added_members_emails = Array.from(uniqueEmailsSet).join(", ");
  return added_members_emails;
}

async function check_if_room_admin(room, email) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.check_if_room_admin",
    args: {
      room: room,
      email: email,
    },
  });
  return await res.message;
}

async function send_message(message_info) {
  const {
    content,
    user,
    room,
    email,
    send_date = null,
    is_first_message = 0,
    attachment = null,
    sub_channel = null,
    is_link = null,
    is_media = null,
    is_document = null,
    is_voice_clip = null,
    file_id = null,
    message_type = "",
    message_template_type = "",
    only_receive_by = null,
    chat_topic = null,
    is_screenshot = 0,
  } = message_info;
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.send",
    args: {
      content: content,
      user: user,
      room: room,
      email: email,
      send_date: send_date,
      is_first_message: is_first_message,
      attachment: attachment,
      sub_channel: sub_channel,
      is_link: is_link,
      is_media: is_media,
      is_document: is_document,
      is_voice_clip: is_voice_clip,
      file_id: file_id,
      message_type: message_type,
      message_template_type: message_template_type,
      only_receive_by: only_receive_by,
      chat_topic: chat_topic,
      is_screenshot: is_screenshot,
    },
  });
  return await res.message.results[0].new_message_name;
}

async function create_sub_channel(params) {
  const {
    new_contributors,
    parent_channel,
    user,
    user_email,
    creation_date = null,
    last_active_sub_channel = null,
    user_to_remove = null,
    empty_contributor_list = 0,
    freeze = false,
  } = params;
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.create_sub_channel",
    args: {
      new_contributors: new_contributors,
      parent_channel: parent_channel,
      user: user,
      user_email: user_email,
      creation_date: creation_date,
      last_active_sub_channel: last_active_sub_channel,
      user_to_remove: user_to_remove,
      empty_contributor_list: empty_contributor_list,
    },
    freeze: freeze,
  });
  return await res.message.results[0].channel;
}

async function get_time_now(user_email, formatted = null) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_time_now",
    args: {
      user_email: user_email,
      formatted: formatted,
    },
  });
  return await res.message;
}

async function get_chat_members(room) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.get_chat_members",
    args: {
      room: room,
    },
  });
  return await res.message.results[0].chat_members;
}

async function check_if_contributor_active(channel, user_email) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.check_if_contributor_active",
    args: {
      channel: channel,
      user_email: user_email,
    },
  });
  return await res.message.results[0].active;
}

function show_overlay(text) {
  let overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0, 0, 0, 0.5)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '9999';
  overlay.style.color = 'white';
  overlay.style.fontSize = '20px';
  overlay.innerText = text;
  document.body.appendChild(overlay);
}

function hide_overlay() {
  let overlay = document.getElementById('loadingOverlay');
  if (overlay) {
      document.body.removeChild(overlay);
  }
}

export {
  get_time,
  scroll_to_bottom,
  get_date_from_now,
  is_date_change,
  mark_messsages_as_read,
  is_image,
  is_video,
  is_audio,
  is_document,
  is_voice_clip,
  set_user_settings,
  get_avatar_html,
  set_notification_count,
  scroll_to_message,
  check_if_chat_window_open,
  is_email,
  is_phone_number,
  contains_arabic,
  get_user_names,
  get_user_emails,
  get_profile_full_name,
  check_if_room_admin,
  convertToUTC,
  send_message,
  create_sub_channel,
  get_time_now,
  get_current_time,
  get_t,
  get_current_datetime,
  get_chat_members,
  check_if_contributor_active,
  show_overlay,
  hide_overlay
};
