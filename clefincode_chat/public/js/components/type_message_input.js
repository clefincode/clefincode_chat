import Quill from "quill";
import "quill/dist/quill.bubble.css";
import "quill/dist/quill.snow.css";
import Mention from "../quill-mention/quill.mention";

Quill.register("modules/mention", Mention, true);

export default class TypeMessageInput {
  constructor(opts) {
    this.wrapper = `<div class='form-control type-message'></div>`;
    this.chat_space = opts.chat_space;

    const app = window.erpnext_chat_app;
    this.is_webview = !!(app && app.is_webview);

    setTimeout(() => {
      this.make_quill_editor();
    }, 500);
  }

  make_quill_editor() {
    if (this.quill) return;

    const editorEl = this.chat_space.$chat_actions.find(".type-message")[0];
    if (!editorEl) return;

    this.quill = new Quill(editorEl, this.get_quill_options());

    $(editorEl).find(".ql-editor").addClass("input-message");

    this.quill.focus();
  }

  get_quill_options() {
    return {
      theme: this.is_webview ? "snow" : "bubble",
      modules: {
        ...(this.is_webview
          ? {
              toolbar: [
                [{ header: [1, 2, 3, 4, 5, 6, false] }],
                [{ color: [] }, { background: [] }],
                [{ direction: "rtl" }],
                [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
                ["bold", "italic", "underline", "strike"],
                ["clean"],
              ],
            }
          : {
              toolbar: [
                [{ header: [1, 2, 3, 4, 5, 6, false] }],
                [{ color: [] }, { background: [] }],
                [{ direction: "rtl" }],
                [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
                ["bold", "italic", "underline", "strike"],
                ["clean"],
              ],
            }),
        mention: this.get_mention_options(),
      },
    };
  }

  get_mention_options() {
    const chat_space = this.chat_space;

    return {
      allowedChars: /^[A-Za-z0-9_:\s-]*$/,
      minChars: 0,
      mentionDenotationChars: ["@"],
      isolateCharacter: true,
      defaultMenuOrientation: "top",
      source: frappe.utils.debounce(async function (search_term, renderList) {
        const method =
          "clefincode_chat.api.api_1_3_3.api.get_names_for_mentions";

        const values = await frappe.xcall(method, {
          search_term: search_term,
          room: chat_space.profile.room,
        });

        renderList(values, search_term);
      }, 300),
      renderItem(item) {
        const value = item.value;
        return `${value} ${
          item.is_doctype != 1 ? frappe.utils.icon("assign") : ``
        }`;
      },
    };
  }
}