// // Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
// // For license information, please see license.txt

// frappe.ui.form.on("Twilio Template", {
// 	refresh(frm) {

// 	},
//     reference_doctype: function(frm) {
//     const ref = frm.doc.reference_doctype;
//     if (!ref) return; 

  
//     frappe.model.with_doctype(ref, () => {
    
//       const fields = frappe.meta.get_docfields(ref);

//       //
//       const link_fields = fields.filter(f => f.fieldtype === "Link" && f.options);
      

//       // Map to "fieldname (LinkedDoctype)"
//       const field_label_map = link_fields.map(f => `${f.fieldname} (${f.options})`);

//       // Add also the reference doctype itself if you want
//       if (!field_label_map.includes(ref)) {
//         field_label_map.push(ref);
//       }

//       // Extract unique link options (target doctypes)
//       // const unique_options = [...new Set(link_fields.map(f => f.options))];
//       //  if (!unique_options.includes(ref)) {
//       //   unique_options.push(ref);
//       // }
//        // Store the list temporarily in the form
//       frm.link_filter_options = field_label_map;

//       // Refresh the child table field so filters take effect
//       frm.fields_dict["variables"].grid.refresh();

     
//     });
//   }
// });


// frappe.ui.form.on('Twilio Template Variable Mapping2', {
//   //   onload: function(frm, cdt, cdn) {
//   //   // Only apply if parent form has the options list
//   //   // console.log(frm.link_filter_options);
//   //   // if (!frm.link_filter_options) return;

//   // //   // Set query (filter) for the Link field inside the child table
//   // //   frm.fields_dict["variables"].grid.get_field("source_doctype")
//   // //     .get_query = function() {
//   // //       return {
//   // //         filters: {
//   // //           name: ["in", frm.link_filter_options]
//   // //         }
//   // //       };
//   // //     };
//   // // },
//   //   // variables_add: function(frm, cdt, cdn) {
//   //   //   console.log(frm.link_filter_options);
//   //   //     // Triggered when a new row is added to the "variables" table
//   //   //     let row = locals[cdt][cdn];
//   //   //     // Set source_doctype = parent reference_doctype
//   //   //     if (frm.doc.reference_doctype) {
            
//   //   //         const row = locals[cdt][cdn];
//   //   //         row.source_doctype.get_query = function() {
//   //   //     return {
//   //   //       filters: {
//   //   //         name: ["in", frm.link_filter_options]
//   //   //       }
//   //   //     };
//   //   //   };
//   //   //     if (!row.source_doctype) return;

        
//   //   //         const meta_fields = frappe.meta.get_docfields(row.source_doctype);

//   //   //         const no_value_fields = frappe.model.no_value_fields || [
//   //   //             'Section Break', 'Column Break', 'HTML', 'Table', 'Button', 'Image', 'Fold'
//   //   //         ];

//   //   //         const fields = meta_fields
//   //   //             .filter(df => !no_value_fields.includes(df.fieldtype))
//   //   //             .map(df => `${df.fieldname}`);

            
//   //   //         frm.fields_dict.variables.grid.update_docfield_property(
// 	// 	// 		"source_field",
// 	// 	// 		"options",
// 	// 	// 		fields
// 	// 	// 	);

//   //           // const grid_row = frm.fields_dict["variables"].grid.get_row(cdn);
//   //           // const source_field_control = grid_row.on_grid_fields_dict.source_field;
//   //           //  console.log(fields);
//   //           // console.log(frm);
//   //           //  console.log(grid_row);



//   //           // if (source_field_control) {
//   //           //     source_field_control.df.options = fields;
//   //           //     source_field_control.refresh();
              
//   //           // } else {
//   //           //     frm.fields_dict["variables"].grid.get_field("source_field").df.options = fields;
//   //           //     frm.refresh_field("variables_mapping");
//   //           // }
       
            
//   //       // }
//   //   }

//   // variables_add: function(frm, cdt, cdn) {
//   //   console.log("Link filter options:", frm.link_filter_options);

//   //   let row = locals[cdt][cdn];

//   //   if (!frm.doc.reference_doctype) {
//   //     frappe.msgprint("Please select a Reference Doctype first.");
//   //     return;
//   //   }

//   //   // Check if grid exists
//   //   const grid = frm.fields_dict["variables"]?.grid;
//   //   if (!grid) {
//   //     console.warn("⚠️ Grid 'variables' not found on form.");
//   //     return;
//   //   }

//   //   // ✅ Safe way: set query filter when grid field exists
//   //   const source_doctype_field = grid.get_field("source_doctype");
//   //   if (source_doctype_field) {
//   //     source_doctype_field.get_query = function() {
//   //       return {
//   //         filters: {
//   //           name: ["in", frm.link_filter_options || []]
//   //         }
//   //       };
//   //     };
//   //   } else {
//   //     console.warn("⚠️ Field 'source_doctype' not found in child table.");
//   //   }

    
//   //   frm.refresh_field("variables");
//   // }

//    variables_add: function(frm, cdt, cdn) {
//     console.log(frm.link_filter_options);
//     let options=frm.link_filter_options;
//     let row = locals[cdt][cdn];
//         // Set source_doctype = parent reference_doctype
//         if (frm.doc.reference_doctype) {
            
//             const row = locals[cdt][cdn];
       

			
            


            
//             frm.fields_dict.variables.grid.update_docfield_property(
// 				"source",
// 				"options",
// 				options.join("\n")
// 			);
//   }
//    }
// });


frappe.ui.form.on("Twilio Template", {
  
    onload(frm) {
    update_link_field_options(frm);
    
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
			

    
  },

  refresh(frm) {
    update_link_field_options(frm);
    console.log("dsds");
        frm.add_custom_button("Check Status", () => {
            frappe.call({
                method: "clefincode_chat.clefincode_chat.doctype.twilio_template.twilio_template.check_status",
                args: {
                    docname: frm.doc.name
                },
                callback(r) {
                    if (r.message) {
                        frappe.msgprint(r.message);
                    }
                }
            });
        });
  },

  reference_doctype(frm) {
    update_link_field_options(frm);
  }
});


// Child Table Script
frappe.ui.form.on("Twilio Template Variable Mapping2", {
  variables_add: function(frm, cdt, cdn) {
    console.log("🔗 Available options:", frm.link_filter_options);

    if (!frm.doc.reference_doctype) {
      frappe.msgprint("Please select a Reference Doctype first.");
      return;
    }

    if (!frm.fields_dict.variables) {
      console.warn("⚠️ 'variables' table not found on the form.");
      return;
    }

    const grid = frm.fields_dict.variables.grid;

    // ✅ Safely update the 'source' (Select) field options
    if (frm.link_filter_options && grid) {
      grid.update_docfield_property(
        "source", // 🔹 Make sure this matches your actual fieldname in the child table
        "options",
        frm.link_filter_options.join("\n")
      );
      frm.refresh_field("variables");
    }
  }
});
frappe.ui.form.on("Twilio Template Variable Mapping2", {
  source(frm, cdt, cdn) {
    console.log("sdsds");
    const row = locals[cdt][cdn];
    if (!row.source) return;

    let doctype_name = row.source;

    //  If the name contains parentheses, extract what's inside
    const match = doctype_name.match(/\(([^)]+)\)/);
    if (match) {
      doctype_name = match[1].trim(); // take only the text inside ()
      console.log("Extracted Doctype:", doctype_name);
    }

    frappe.model.with_doctype(doctype_name, () => {
      const meta_fields = frappe.meta.get_docfields(doctype_name);

      const no_value_fields = frappe.model.no_value_fields || [
        "Section Break", "Column Break", "HTML", "Table", "Button", "Image", "Fold"
      ];

      const fields = meta_fields
        .filter(df => !no_value_fields.includes(df.fieldtype))
        .map(df => df.fieldname);

       const standard_fields = [
        "name", "owner", "creation"      
      ];

      // Combine both lists and remove duplicates
      const all_fields = [...new Set([...standard_fields, ...fields])];

      const grid_row = frm.fields_dict["variables"].grid.get_row(cdn);
      const source_field_control = grid_row.on_grid_fields_dict.source_field;

      if (source_field_control) {
        source_field_control.df.options = all_fields;
        source_field_control.refresh();
      } else {
        frm.fields_dict["variables"].grid.get_field("source_field").df.options = all_fields;
        frm.refresh_field("variables");
      }
    });
  }
});
function update_link_field_options(frm) {
  const ref = frm.doc.reference_doctype;

  if (!ref) {
    console.log(" No Reference Doctype selected yet.");
    return;
  }

  // Load metadata for the selected reference doctype
  frappe.model.with_doctype(ref, () => {
    const fields = frappe.meta.get_docfields(ref);

    // Filter only link-type fields that have valid options
    const link_fields = fields.filter(f => f.fieldtype === "Link" && f.options);

    // Map to "fieldname (LinkedDoctype)" format
    const field_label_map = link_fields.map(f => `${f.fieldname} (${f.options})`);

    // Optionally include the reference doctype itself
    if (!field_label_map.includes(ref)) {
      field_label_map.push(ref);
    }

    // Store for later use (e.g., child table filters)
    frm.link_filter_options = field_label_map;

    console.log("📋 Link/Field options updated:", field_label_map);

    // Refresh the child table grid
    if (frm.fields_dict.variables) {
      frm.fields_dict.variables.grid.refresh();
    }
  });
}
