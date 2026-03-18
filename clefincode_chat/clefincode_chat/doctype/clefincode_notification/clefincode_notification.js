// Copyright (c) 2025
// For license information, please see license.txt

frappe.notification = {
		get_profile_contact_type_by_channel: function(channel) {
		const map = {
			WhatsApp: "WhatsApp",
			Telegram: "Telegram",
			Instagram: "Instagram",
			Messenger: "Messenger",
			Chat: "Chat",
			Email: "Email"
		};

		return map[channel] || null;
	},

	setup_fixed_profile_number: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row) return;

		
		frappe.notification.set_child_df_options(cdt, cdn, "fixed_profile_number", []);

		if (
			row.recipient_source !== "Fixed Value" ||
			row.receiver_value_type !== "Profile" ||
			!row.fixed_chat_profile
		) {
			row.fixed_profile_number = "";
			frm.refresh_field("clefincode_notification_recipient_list");
			return;
		}

		frappe.call({
			method: "frappe.client.get",
			args: {
				doctype: "ClefinCode Chat Profile",
				name: row.fixed_chat_profile
			},
			callback: function(r) {
				if (!r.message) {
					row.fixed_profile_number = "";
					frm.refresh_field("clefincode_notification_recipient_list");
					return;
				}

				const profile = r.message;
				const expected_type = frappe.notification.get_profile_contact_type_by_channel(frm.doc.channel);

				let options = (profile.contact_details || [])
					.filter(d => d.contact_info)
					.filter(d => !expected_type || d.type === expected_type)
					.map(d => d.contact_info);

				options = [...new Set(options)];

				frappe.notification.set_child_df_options(cdt, cdn, "fixed_profile_number", options);

			
				if (!options.includes(row.fixed_profile_number)) {
					row.fixed_profile_number = "";
				}

				frm.refresh_field("clefincode_notification_recipient_list");
			}
		});
	},
	setup_fieldname_select: function (frm) {
		if (!frm.doc.reference_doctype) return;

		frappe.model.with_doctype(frm.doc.reference_doctype, function () {
			let fields = frappe.get_doc("DocType", frm.doc.reference_doctype).fields || [];

			let get_select_options = function (df, parent_field) {
				let select_value = parent_field ? `${df.fieldname},${parent_field}` : df.fieldname;
				let path = parent_field ? `${parent_field} > ${df.fieldname}` : df.fieldname;
				return {
					value: select_value,
					label: `${path} (${__(df.label, null, df.parent)})`,
				};
			};

			let get_date_change_options = function () {
				let date_options = $.map(fields, function (d) {
					return ["Date", "Datetime"].includes(d.fieldtype)
						? get_select_options(d)
						: null;
				});

				return date_options.concat([
					{ value: "creation", label: `creation (${__("Created On")})` },
					{ value: "modified", label: `modified (${__("Last Modified Date")})` },
				]);
			};

			let options = $.map(fields, function (d) {
				return frappe.model.no_value_type.includes(d.fieldtype)
					? null
					: get_select_options(d);
			});

			frm.set_df_property("date_changed", "options", get_date_change_options());
			frm.set_df_property("set_property_after_alert", "options", [""].concat(options));

			// value_changed يتحدد حسب نوع الحدث
			frappe.notification.setup_value_changed_select(frm);
		});
	},

	setup_value_changed_select: function (frm) {
		if (!frm.doc.reference_doctype) return;

		const no_value_fields = frappe.model.no_value_type || frappe.model.no_value_fields || [
			"Section Break",
			"Column Break",
			"HTML",
			"Table",
			"Button",
			"Image",
			"Fold"
		];

		// Value Change على الـ parent doctype
		if (frm.doc.doctype_event === "Value Change") {
			frappe.model.with_doctype(frm.doc.reference_doctype, function () {
				const fields = frappe.meta.get_docfields(frm.doc.reference_doctype) || [];

				const options = fields
					.filter(df => !no_value_fields.includes(df.fieldtype))
					.map(df => ({
						value: df.fieldname,
						label: `${df.fieldname} (${__(df.label || df.fieldname)})`
					}));

				frm.set_df_property("value_changed", "options", [""].concat(options));
				frm.refresh_field("value_changed");
			});
			return;
		}

		// Child Table Change Value على الـ child table
		if (frm.doc.doctype_event === "Child Table Change Value") {
			if (!frm.doc.child_table_field) {
				frm.set_df_property("value_changed", "options", [""]);
				frm.refresh_field("value_changed");
				return;
			}

			frappe.model.with_doctype(frm.doc.reference_doctype, function () {
				const parent_fields = frappe.meta.get_docfields(frm.doc.reference_doctype) || [];
				const table_df = parent_fields.find(df => df.fieldname === frm.doc.child_table_field);

				if (!table_df || !table_df.options) {
					frm.set_df_property("value_changed", "options", [""]);
					frm.refresh_field("value_changed");
					return;
				}

				frappe.model.with_doctype(table_df.options, function () {
					const child_fields = frappe.meta.get_docfields(table_df.options) || [];

					const options = child_fields
						.filter(df => !no_value_fields.includes(df.fieldtype))
						.map(df => ({
							value: df.fieldname,
							label: `${df.fieldname} (${__(df.label || df.fieldname)})`
						}));

					frm.set_df_property("value_changed", "options", [""].concat(options));
					frm.refresh_field("value_changed");
				});
			});
			return;
		}

		frm.set_df_property("value_changed", "options", [""]);
		frm.refresh_field("value_changed");
	},

	setup_variable_source_field: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row || !row.source_type || !frm.doc.reference_doctype) return;

		const no_value_fields = frappe.model.no_value_fields || [
			"Section Break", "Column Break", "HTML", "Table", "Button", "Image", "Fold"
		];

		if (row.source_type === "Document Field") {
			frappe.model.with_doctype(frm.doc.reference_doctype, function() {
				const meta_fields = frappe.meta.get_docfields(frm.doc.reference_doctype) || [];

				const fields = meta_fields
					.filter(df => !no_value_fields.includes(df.fieldtype))
					.map(df => df.fieldname);

				frappe.meta.get_docfield(cdt, "source_field", cdn).options = [""].concat(fields).join("\n");
				frm.refresh_field("variables");
			});
		}

		if (row.source_type === "Child Row Field") {
			if (!frm.doc.child_table_field) return;

			frappe.model.with_doctype(frm.doc.reference_doctype, function() {
				const parent_meta_fields = frappe.meta.get_docfields(frm.doc.reference_doctype) || [];
				const table_df = parent_meta_fields.find(df => df.fieldname === frm.doc.child_table_field);

				if (!table_df || !table_df.options) return;

				frappe.model.with_doctype(table_df.options, function() {
					const child_meta_fields = frappe.meta.get_docfields(table_df.options) || [];

					const fields = child_meta_fields
						.filter(df => !no_value_fields.includes(df.fieldtype))
						.map(df => df.fieldname);

					frappe.meta.get_docfield(cdt, "source_field", cdn).options = [""].concat(fields).join("\n");
					frm.refresh_field("variables");
				});
			});
		}
	},

	setup_child_table_select: function(frm) {
		if (!frm.doc.reference_doctype) return;

		frappe.model.with_doctype(frm.doc.reference_doctype, function() {
			let fields = frappe.get_doc("DocType", frm.doc.reference_doctype).fields || [];

			let table_options = fields
				.filter(df => df.fieldtype === "Table")
				.map(df => df.fieldname);

			frm.set_df_property("child_table_field", "options", [""].concat(table_options).join("\n"));
			frm.refresh_field("child_table_field");
		});
	},

	get_reference_fields: function(frm) {
		if (!frm.doc.reference_doctype) return [];
		return frappe.meta.get_docfields(frm.doc.reference_doctype) || [];
	},

	get_profile_link_fields: function(frm) {
		return frappe.notification.get_reference_fields(frm)
			.filter(df => df.fieldtype === "Link" && df.options === "ClefinCode Chat Profile")
			.map(df => df.fieldname);
	},

	get_link_fields: function(frm) {
		return frappe.notification.get_reference_fields(frm)
			.filter(df => df.fieldtype === "Link")
			.map(df => df.fieldname);
	},

	get_phone_or_data_fields: function(frm) {
		return frappe.notification.get_reference_fields(frm)
			.filter(df => ["Phone", "Data"].includes(df.fieldtype))
			.map(df => df.fieldname);
	},

	set_child_df_options: function(cdt, cdn, fieldname, options) {
		let df = frappe.meta.get_docfield(cdt, fieldname, cdn);
		if (df) {
			df.options = [""].concat(options || []).join("\n");
		}
	},

	toggle_linked_phone_field: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		let grid_row = frm.fields_dict.clefincode_notification_recipient_list.grid.grid_rows_by_docname[cdn];

		if (grid_row && grid_row.doc) {
			grid_row.toggle_editable("linked_phone_field", row.recipient_source === "From Linked Field");
		}
	},

	setup_recipient_row: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row || !frm.doc.reference_doctype || !row.recipient_source) return;

		frappe.model.with_doctype(frm.doc.reference_doctype, function() {
			frappe.notification.set_child_df_options(cdt, cdn, "receiver_field", []);
			frappe.notification.set_child_df_options(cdt, cdn, "linked_phone_field", []);

			if (row.recipient_source === "From Profile Field") {
				frappe.notification.set_child_df_options(
					cdt,
					cdn,
					"receiver_field",
					frappe.notification.get_profile_link_fields(frm)
				);
				row.linked_phone_field = "";
			}

			else if (row.recipient_source === "From Field") {
				frappe.notification.set_child_df_options(
					cdt,
					cdn,
					"receiver_field",
					frappe.notification.get_phone_or_data_fields(frm)
				);
				row.linked_phone_field = "";
			}

			else if (row.recipient_source === "From Linked Field") {
				frappe.notification.set_child_df_options(
					cdt,
					cdn,
					"linked_phone_field",
					frappe.notification.get_link_fields(frm)
				);

				if (row.linked_phone_field) {
					const meta_fields = frappe.meta.get_docfields(frm.doc.reference_doctype) || [];
					const link_df = meta_fields.find(df => df.fieldname === row.linked_phone_field);

					if (link_df && link_df.fieldtype === "Link" && link_df.options) {
						frappe.model.with_doctype(link_df.options, function() {
							const linked_fields = (frappe.meta.get_docfields(link_df.options) || [])
								.filter(df => ["Phone", "Data"].includes(df.fieldtype))
								.map(df => df.fieldname);

							frappe.notification.set_child_df_options(
								cdt,
								cdn,
								"receiver_field",
								linked_fields
							);

							frm.refresh_field("clefincode_notification_recipient_list");
							frappe.notification.toggle_linked_phone_field(frm, cdt, cdn);
						});
						return;
					}
				}
			}

			frm.refresh_field("clefincode_notification_recipient_list");
			frappe.notification.toggle_linked_phone_field(frm, cdt, cdn);
		});
	},

	setup_all_recipient_rows: function(frm) {
		(frm.doc.clefincode_notification_recipient_list || []).forEach(row => {
			frappe.notification.setup_recipient_row(frm, row.doctype, row.name);
		});
	}
};

frappe.ui.form.on("Clefincode Notification", {
	 setup(frm) {
        frm.fields_dict.clefincode_notification_recipient_list.grid.get_field('fixed_chat_profile').get_query = function(doc, cdt, cdn) {
            return {
                query: 'clefincode_chat.api.api_1_3_3.api.get_chat_profiles_by_channel',
                filters: {
                    channel: doc.channel
                }
            };
        };
    },
	onload: function (frm) {
		frm.set_query("reference_doctype", function () {
			return {
				filters: {
					istable: 0,
				},
			};
		});

		frm.set_query("print_format", function () {
			return {
				filters: {
					doc_type: frm.doc.reference_doctype,
				},
			};
		});

		frm.set_query("template", function () {
			return {
				filters: {
					reference_doctype: frm.doc.reference_doctype,
				},
			};
		});
	},

	refresh: function(frm) {
		frm.trigger("load_template");

		if (frm.doc.channel === "Telegram") {
			frm.set_value("message_type", "Message");
			frm.set_df_property("message_type", "read_only", 1);
		} else {
			frm.set_df_property("message_type", "read_only", 0);
		}

		frappe.notification.setup_fieldname_select(frm);
		frappe.notification.setup_child_table_select(frm);
		frappe.notification.setup_all_recipient_rows(frm);

		(frm.doc.variables || []).forEach(row => {
			if (row.source_type) {
				frappe.notification.setup_variable_source_field(frm, row.doctype, row.name);
			}
		});
	},

	template: function (frm) {
		frm.trigger("load_template");

		if (frm.doc.template) {
			frappe.call({
				method: "frappe.client.get",
				args: {
					doctype: "CiC Twilio Template",
					name: frm.doc.template
				},
				callback: function(r) {
					if (r.message) {
						let allow_attachment = r.message.attach_document_print;

						if (allow_attachment) {
							frm.set_value("attach_document_print", 1);
						} else {
							frm.set_value("attach_document_print", 0);
						}
					}
				}
			});
		}
	},

	doctype_event: function(frm) {
		frappe.notification.setup_value_changed_select(frm);
	},

	child_table_field: function(frm) {
		frappe.notification.setup_value_changed_select(frm);

		(frm.doc.variables || []).forEach(row => {
			if (row.source_type === "Child Row Field") {
				frappe.notification.setup_variable_source_field(frm, row.doctype, row.name);
			}
		});
	},

	reference_doctype: function(frm) {
		frappe.notification.setup_fieldname_select(frm);
		frappe.notification.setup_child_table_select(frm);
		frappe.notification.setup_all_recipient_rows(frm);
		frappe.notification.setup_value_changed_select(frm);

		(frm.doc.variables || []).forEach(row => {
			if (row.source_type) {
				frappe.notification.setup_variable_source_field(frm, row.doctype, row.name);
			}
		});
	},

	channel: function(frm) {
		if (frm.doc.channel === "Telegram") {
			frm.set_value("message_type", "Message");
			frm.set_df_property("message_type", "read_only", 1);
		} else {
			frm.set_df_property("message_type", "read_only", 0);
		}
	},

	custom_attachment: function (frm) {
		if (frm.doc.custom_attachment == 1 && ["DOCUMENT", "IMAGE"].includes(frm.doc.header_type)) {
			frm.set_df_property("file_name", "reqd", 1);
		} else {
			frm.set_df_property("file_name", "reqd", 0);
		}

		if (frm.doc.header_type) {
			frm.set_value("attach_document_print", !frm.doc.custom_attachment);
		}
	},

	attach_document_print: function(frm) {
		if (frm.doc.attach_document_print) {
			frappe.confirm(
				__('By selecting "Attach Print", the currently defined media variable will be replaced with the print file that will be sent. Do you want to continue?'),
				function() {
					frappe.msgprint(__('You have chosen to attach the print file. The media variable will be updated accordingly.'));
				},
				function() {
					frm.set_value("attach_document_print", 0);
					frappe.msgprint(__('Operation cancelled. The media variable remains unchanged.'));
				}
			);
		}

		if (["DOCUMENT", "IMAGE"].includes(frm.doc.header_type)) {
			frm.set_value("custom_attachment", !frm.doc.attach_document_print);
		}
	},

	load_template: function (frm) {

	}
});

frappe.ui.form.on("CiC Twilio Template Variable Mapping Notification", {
	source_type: function(frm, cdt, cdn) {
		frappe.notification.setup_variable_source_field(frm, cdt, cdn);
	},

	form_render: function(frm, cdt, cdn) {
		frappe.notification.setup_variable_source_field(frm, cdt, cdn);
	},

	variables_add: function(frm, cdt, cdn) {
		frappe.notification.setup_variable_source_field(frm, cdt, cdn);
	}
});

frappe.ui.form.on("Clefincode Notification Recipient list", {
	clefincode_notification_recipient_list_add: function(frm, cdt, cdn) {
		frappe.notification.setup_recipient_row(frm, cdt, cdn);
		frappe.notification.setup_fixed_profile_number(frm, cdt, cdn);
	},

	form_render: function(frm, cdt, cdn) {
		frappe.notification.setup_recipient_row(frm, cdt, cdn);
		frappe.notification.setup_fixed_profile_number(frm, cdt, cdn);
	},

	recipient_source: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		row.receiver_field = "";
		row.linked_phone_field = "";
		row.fixed_profile_contact = "";
		frappe.notification.setup_recipient_row(frm, cdt, cdn);
		frappe.notification.setup_fixed_profile_number(frm, cdt, cdn);
	},

	receiver_value_type: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		row.fixed_profile_contact = "";
		frappe.notification.setup_fixed_profile_number(frm, cdt, cdn);
	},

	fixed_chat_profile: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		row.fixed_profile_contact = "";
		frappe.notification.setup_fixed_profile_number(frm, cdt, cdn);
	},

	linked_phone_field: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (row.recipient_source === "From Linked Field") {
			row.receiver_field = "";
			frappe.notification.setup_recipient_row(frm, cdt, cdn);
		}
	}
});