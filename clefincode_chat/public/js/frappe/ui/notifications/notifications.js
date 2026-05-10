frappe.provide("frappe.ui");

(() => {
	const OriginalNotifications = frappe.ui.Notifications;

	if (!OriginalNotifications) {
		console.warn(
			"frappe.ui.Notifications is not available yet. Make sure this file loads after Frappe notifications."
		);
		return;
	}

	frappe.ui.Notifications = class ClefinCodeNotifications extends OriginalNotifications {
		constructor(opts) {
			super(opts);

			setTimeout(() => {
				this.setup_clefincode_chat_notification_actions();
			}, 0);
		}

		setup_clefincode_chat_notification_actions() {
			const notifications_view = this.tabs?.notifications;

			if (!notifications_view || notifications_view.__clefincode_chat_patched) {
				return;
			}

			notifications_view.__clefincode_chat_patched = true;

			const original_get_dropdown_item_html =
				notifications_view.get_dropdown_item_html.bind(notifications_view);

			notifications_view.get_dropdown_item_html = (notification_log) => {
				const item_html = original_get_dropdown_item_html(notification_log);

				const is_chat_topic_notification =
					cint(notification_log.chat_topic) === 1 &&
					cint(notification_log.approved) === 0;

				if (!is_chat_topic_notification) {
					return item_html;
				}

				const $timestamp = item_html.find(".notification-timestamp");

				$timestamp.css({
					display: "flex",
					"justify-content": "space-between",
					gap: "8px",
					"align-items": "center",
				});

				const $approve_btn = $(`
					<div class="btn btn-primary approved-btn">
						${__("Approve")}
					</div>
				`);

				$approve_btn.on("click", (e) => {
					e.preventDefault();
					e.stopImmediatePropagation();

					const notification_log_name =
						item_html.data("name") || notification_log.name;

					$approve_btn.remove();

					approve_access_request(
						frappe.session.user,
						notification_log.from_user,
						notification_log.email_content,
						notification_log_name,
						notification_log.email_content,
						notification_log.document_type,
						notification_log.document_name
					);

					frappe.msgprint(__("Approval has been sent"));
				});

				$timestamp.append($approve_btn);

				return item_html;
			};

			if (notifications_view.dropdown_items?.length) {
				notifications_view.render_notifications_dropdown();
			}
		}
	};

	function approve_access_request(
		sender,
		reciever,
		chat_topic,
		notification_log,
		chat_topic_subject,
		reference_doctype,
		reference_docname
	) {
		return frappe.call({
			method: "clefincode_chat.api.api_1_2_1.api.approve_access_request",
			args: {
				sender,
				reciever,
				chat_topic,
				notification_log,
				chat_topic_subject,
				reference_doctype,
				reference_docname,
			},
		});
	}
})();