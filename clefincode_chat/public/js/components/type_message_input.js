import Quill from "quill";
import Mention from "../quill-mention/quill.mention";

Quill.register("modules/mention", Mention, true);

export default class TypeMessageInput {
  constructor(opts) {
    this.wrapper = `<div class='form-control type-message'></div>`;
    this.chat_space = opts.chat_space;

    setTimeout(() => {
      this.make_quill_editor();
    }, 500);
  }

  make_quill_editor() {
    if (this.quill) return;
    this.quill = new Quill(
      this.chat_space.$chat_actions.find(".type-message")[0],
      this.get_quill_options()
    );
    this.quill.focus();
  }

  get_quill_options() {
    return {
      modules: {
        mention: this.get_mention_options(),
      },
    };
  }

  get_mention_options() {
    return {
      allowedChars: /^[A-Za-z0-9_:\s-]*$/,
      minChars: 0,
      mentionDenotationChars: ["@"],
      isolateCharacter: true,
      defaultMenuOrientation: "top",
      source: frappe.utils.debounce(async function (search_term, renderList) {
        let method = "clefincode_chat.api.api_1_0_1.api.get_names_for_mentions";
        let values = await frappe.xcall(method, {
          search_term,
        });
        renderList(values, search_term);
      }, 300),
      renderItem(item) {
        let value = item.value;
        return `${value} ${
          item.is_doctype != 1 ? frappe.utils.icon("assign") : ``
        }`;
      },
    };
  }
}
