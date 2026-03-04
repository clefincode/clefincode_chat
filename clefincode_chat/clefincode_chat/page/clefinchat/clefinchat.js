frappe.pages['clefinchat'].on_page_load = function (wrapper) {

    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Chat',
        single_column: true
    });


    page.main.html(`
        <div id="chat-webview-container"></div>
    `);

    if (!window.location.search.includes("webview=1")) {
        const url = new URL(window.location.href);
        url.searchParams.set("webview", "1");
        window.location.href = url.toString();
    }


    const style = document.createElement("style");
    style.innerHTML = `
        body {
            margin: 0;
            overflow: hidden;
        }

        .layout-main-section {
            padding: 0 !important;
        }

        .chat-app {
            position: fixed;
            inset: 0;
            height: 100vh;
            width: 100vw;
        }

        .chat_right_section,
        .chat-element {
            height: 100vh !important;
            width: 100% !important;
        }

        .chat_left_section {
            display: block !important;
        }

        .chat-bubble,
        .chat-navbar-icon {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
};