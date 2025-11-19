// Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
// For license information, please see license.txt

frappe.ui.form.on('Clefincode Chat Template', {
	// refresh: function(frm) {

	// }
});
frappe.ui.form.on("Twilio Template Variable Mapping", {
    source_doctype(frm, cdt, cdn) {
     
        const row = locals[cdt][cdn];
        if (!row.source_doctype) return;

        frappe.model.with_doctype(row.source_doctype, () => {
            const meta_fields = frappe.meta.get_docfields(row.source_doctype);

            const no_value_fields = frappe.model.no_value_fields || [
                'Section Break', 'Column Break', 'HTML', 'Table', 'Button', 'Image', 'Fold'
            ];

            const fields = meta_fields
                .filter(df => !no_value_fields.includes(df.fieldtype))
                .map(df => `${df.fieldname}`);

            const grid_row = frm.fields_dict["variables"].grid.get_row(cdn);
            const source_field_control = grid_row.on_grid_fields_dict.source_field;

            if (source_field_control) {
                source_field_control.df.options = fields;
                source_field_control.refresh();
              
            } else {
                frm.fields_dict["variables"].grid.get_field("source_field").df.options = fields;
                frm.refresh_field("variables_mapping");
            }
        });
    }
});
