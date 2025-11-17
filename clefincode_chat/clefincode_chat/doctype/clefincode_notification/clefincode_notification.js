// Copyright (c) 2025
// For license information, please see license.txt

frappe.notification = {
	setup_fieldname_select: function (frm) {
		if (!frm.doc.reference_doctype) return;

		frappe.model.with_doctype(frm.doc.reference_doctype, function () {
			let fields = frappe.get_doc("DocType", frm.doc.reference_doctype).fields;

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
			frm.set_df_property("value_changed", "options", [""].concat(options));
			frm.set_df_property("set_property_after_alert", "options", [""].concat(options));
		});
	},

	setup_alerts_button: function (frm) {
		frm.add_custom_button(__('Get Alerts for Today'), function () {
			frappe.call({
				method: 'clefincode_chat.clefincode_chat.doctype.clefincode_notification.clefincode_notification.call_trigger_notifications',
				args: { method: 'daily' },
				callback: function (response) {
					if (response.message && response.message.length > 0) {
						frappe.msgprint(__('Alerts triggered successfully'));
					} else {
						frappe.msgprint(__('No alerts for today'));
					}
				},
				error: function () {
					frappe.msgprint(__('Failed to trigger notifications'));
				}
			});
		});
	}
};

frappe.ui.form.on('Clefincode Notification', {
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
	refresh: function (frm) {
		frm.trigger("load_template");
		frappe.notification.setup_fieldname_select(frm);
		frappe.notification.setup_alerts_button(frm);
	},

	template: function (frm) {
		frm.trigger("load_template");
	},

	// load_template: function (frm) {
	// 	if (!frm.doc.template) return;

	// 	frappe.db.get_value("Twilio Template", frm.doc.template, ["body", "header_type"], (r) => {
	// 		if (r) {
	// 			frm.set_value("header_type", r.header_type || "");
	// 			frm.refresh_field("header_type");

	// 			if (["DOCUMENT", "IMAGE"].includes(r.header_type)) {
	// 				frm.toggle_display("custom_attachment", true);
	// 				frm.toggle_display("attach_document_print", true);
	// 				if (!frm.doc.custom_attachment) frm.set_value("attach_document_print", 1);
	// 			} else {
	// 				frm.toggle_display("custom_attachment", false);
	// 				frm.toggle_display("attach_document_print", false);
	// 				frm.set_value("attach_document_print", 0);
	// 				frm.set_value("custom_attachment", 0);
	// 			}

	// 			frm.refresh_field("custom_attachment");
	// 			frm.set_value("template_content", r.body || "");
	// 			frm.refresh_field("template_content");
	// 		}
	// 	});
	// },

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

	attach_document_print: function (frm) {
		if (["DOCUMENT", "IMAGE"].includes(frm.doc.header_type)) {
			frm.set_value("custom_attachment", !frm.doc.attach_document_print);
		}
	},

	reference_doctype: function (frm) {
		frappe.notification.setup_fieldname_select(frm);
	},
	attach_document_print: function(frm) {
        if (frm.doc.attach_document_print) {
            frappe.confirm(
                __('By selecting "Attach Print", the currently defined media variable will be replaced with the print file that will be sent. Do you want to continue?'),
                function() {
                    // User confirmed
                    frappe.msgprint(__('You have chosen to attach the print file. The media variable will be updated accordingly.'));
                },
                function() {
                    // User cancelled → uncheck the box
                    frm.set_value('attach_print', 0);
                    frappe.msgprint(__('Operation cancelled. The media variable remains unchanged.'));
                }
            );
        }
    }
});
frappe.ui.form.on('Twilio Template Variable Mapping', {
    variables_add: function(frm, cdt, cdn) {
        // Triggered when a new row is added to the "variables" table
        let row = locals[cdt][cdn];
        // Set source_doctype = parent reference_doctype
        if (frm.doc.reference_doctype) {
            frappe.model.set_value(cdt, cdn, 'source_doctype', frm.doc.reference_doctype);
            const row = locals[cdt][cdn];
        if (!row.source_doctype) return;

			console.log(row.source_doctype);
            const meta_fields = frappe.meta.get_docfields(row.source_doctype);

            const no_value_fields = frappe.model.no_value_fields || [
                'Section Break', 'Column Break', 'HTML', 'Table', 'Button', 'Image', 'Fold'
            ];

            const fields = meta_fields
                .filter(df => !no_value_fields.includes(df.fieldtype))
                .map(df => `${df.fieldname}`);

            
            frm.fields_dict.variables.grid.update_docfield_property(
				"source_field",
				"options",
				fields
			);

            // const grid_row = frm.fields_dict["variables"].grid.get_row(cdn);
            // const source_field_control = grid_row.on_grid_fields_dict.source_field;
            //  console.log(fields);
            // console.log(frm);
            //  console.log(grid_row);



            // if (source_field_control) {
            //     source_field_control.df.options = fields;
            //     source_field_control.refresh();
              
            // } else {
            //     frm.fields_dict["variables"].grid.get_field("source_field").df.options = fields;
            //     frm.refresh_field("variables_mapping");
            // }
       
            
        }
    }
});
