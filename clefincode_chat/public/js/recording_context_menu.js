// ClefinCode Chat recording asset
(function (window, document) {
    "use strict";
    if (window.CCRecordingMenuIntegration?.installed) return;
    const VERSION = "4.3.0";
    const API = "clefincode_chat.api.api_1_4_1.audio_features.";
    const FEATURES_URL = "/assets/clefincode_chat/js/recording_features.js";
    const MENU_SELECTOR = ".message-action-menu";
    const INFO_SELECTOR = ".message-info-action";
    const TRIGGER_SELECTOR = ".message-menu-trigger";
    const ACTION_CLASS = "cc-recording-menu-action";
    const actions = [
        { id: "search", text: "Find Word in Recordings", symbol: "\ud83d\udd0e" }
    ];
    let lastTrigger = null;
    let queued = false;
    const menuBusy = new WeakMap();
    const menuContexts = new WeakMap();
    const probeCache = new Map();
    const probeResults = new Map();
    function label(text) {
        return typeof window.__ === "function" ? window.__(text) : text;
    }
    function menuMessageName(menu) {
        const info = menu.querySelector(INFO_SELECTOR);
        const fromInfo = info?.getAttribute("data-message-name") || info?.dataset?.messageName;
        const fromMenu = menu.getAttribute("data-message-name") || menu.dataset?.messageName;
        const fromParent = menu.closest("[data-message-name]")?.getAttribute("data-message-name");
        return String(fromInfo || fromMenu || fromParent || lastTrigger?.name || "").trim();
    }
    function probe(name) {
        const cached = probeCache.get(name);
        if (cached && cached.expiresAt > Date.now()) return cached.promise;
        const promise = window.frappe.call({
            method: API + "probe_voice_recording",
            type: "GET",
            args: { message_name: name }
        }).then(response => {
            const data = response?.message || { is_recording: false };
            probeResults.set(name, data);
            return data;
        }).catch(error => {
            probeResults.set(name, { probe_failed: true });
            console.warn("[CC recording menu] probe failed for", name, error);
            return { is_recording: false, probe_failed: true };
        });
        probeCache.set(name, { promise, expiresAt: Date.now() + 15000 });
        if (probeCache.size > 250) probeCache.delete(probeCache.keys().next().value);
        return promise;
    }
    function insertActions(menu, name, serverInfo) {
        if (!menu.isConnected || menu.dataset.ccRecordingMenuFor === name) return;
        const infoAction = menu.querySelector(INFO_SELECTOR);
        if (!infoAction?.parentNode) return;
        menu.querySelectorAll("." + ACTION_CLASS).forEach(node => node.remove());
        const parent = infoAction.parentNode;
        const divider = document.createElement("div");
        divider.className = ACTION_CLASS;
        divider.setAttribute("role", "separator");
        divider.style.cssText = "height:1px;margin:5px 8px;background:var(--border-color,#ddd);";
        parent.insertBefore(divider, infoAction);
        const context = {
            name,
            channel: serverInfo.chat_channel || "",
            subChannel: serverInfo.sub_channel || null,
            chatTopic: serverInfo.chat_topic || null
        };
        menuContexts.set(menu, context);
        for (const action of actions) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "menu-item " + ACTION_CLASS;
            item.dataset.recordingAction = action.id;
            item.dataset.messageName = name;
            item.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;" +
                "background:transparent;color:inherit;border:0;text-align:left;" +
                "padding:8px 12px;cursor:pointer;font:inherit;";
            const icon = document.createElement("span");
            icon.textContent = action.symbol;
            icon.style.cssText = "flex:0 0 22px;text-align:center;";
            icon.setAttribute("aria-hidden", "true");
            const text = document.createElement("span");
            text.className = "menu-label";
            text.textContent = label(action.text);
            item.appendChild(icon);
            item.appendChild(text);
            parent.insertBefore(item, infoAction);
        }
        menu.style.maxHeight = "min(75vh, 520px)";
        menu.style.overflowY = "auto";
        menu.dataset.ccRecordingMenuFor = name;
    }
    async function inspectMenu(menu) {
        if (!menu.isConnected || !menu.querySelector(INFO_SELECTOR)) return;
        const name = menuMessageName(menu);
        if (!name || menu.dataset.ccRecordingMenuFor === name) return;
        if (menuBusy.get(menu) === name) return;
        menuBusy.set(menu, name);
        try {
            const info = await probe(name);
            if (!menu.isConnected || menuMessageName(menu) !== name) return;
            if (info.is_recording === true || info.is_recording === 1) {
                insertActions(menu, name, info);
            } else {
                menu.querySelectorAll("." + ACTION_CLASS).forEach(node => node.remove());
                delete menu.dataset.ccRecordingMenuFor;
            }
        } finally {
            if (menuBusy.get(menu) === name) menuBusy.delete(menu);
        }
    }
    function scanMenus() {
        if (queued) return;
        queued = true;
        setTimeout(() => {
            queued = false;
            document.querySelectorAll(MENU_SELECTOR).forEach(menu => {
                void inspectMenu(menu);
            });
        }, 0);
    }
    function captureTrigger(event) {
        const trigger = event.target.closest?.(TRIGGER_SELECTOR);
        if (!trigger) return;
        const row = trigger.closest("[data-message-name]");
        if (!row) return;
        const name = row.getAttribute("data-message-name") || "";
        if (name) lastTrigger = { name, at: Date.now() };
        scanMenus();
    }
    // v4.3: load the inline checkbox UI at startup, even when the user never
    // opens a message menu. Frappe may not be initialized when this asset first
    // executes, so bootstrap safely once frappe.require becomes available.
    let featuresPromise = null;
    let featureRetryTimer = null;
    function getFeatures() {
        if (window.CCRecordingFeatures) return Promise.resolve(window.CCRecordingFeatures);
        if (featuresPromise) return featuresPromise;
        if (typeof window.frappe?.require !== "function") {
            return Promise.reject(new Error("Frappe asset loader is not initialized yet."));
        }
        featuresPromise = Promise.resolve(window.frappe.require(FEATURES_URL))
            .then(() => {
                if (!window.CCRecordingFeatures) {
                    throw new Error("Missing recording_features.js: " + FEATURES_URL);
                }
                return window.CCRecordingFeatures;
            }).finally(() => { featuresPromise = null; });
        return featuresPromise;
    }
    function startRecordingCheckboxes() {
        if (featureRetryTimer !== null) {
            window.clearTimeout(featureRetryTimer);
            featureRetryTimer = null;
        }
        if (window.CCRecordingFeatures) {
            window.CCRecordingFeatures.refreshAll?.();
            return;
        }
        if (typeof window.frappe?.require === "function") {
            void getFeatures().catch(error =>
                console.warn("[CC recording] automatic checkbox initialization failed", error));
            return;
        }
        // An early-loaded asset must wait for Frappe. A user click also retries.
        let attempts = 0;
        const retry = () => {
            if (window.CCRecordingFeatures) return;
            if (typeof window.frappe?.require === "function") {
                void getFeatures().catch(error =>
                    console.warn("[CC recording] checkbox initialization failed", error));
            } else if (++attempts < 120) {
                featureRetryTimer = window.setTimeout(retry, 250);
            }
        };
        featureRetryTimer = window.setTimeout(retry, 250);
    }
    async function runAction(action, context) {
        try {
            const f = await getFeatures();
            if (action === "search") {
                if (!context.channel) throw new Error("Recording channel is missing.");
                return f.search(context.channel, {
                    subChannel: null,
                    chatTopic: null
                });
            }
        } catch (error) {
            console.error("[CC recording menu] action failed:", error);
            window.frappe.msgprint({
                title: label("Recording AI"),
                message: label("Recording feature could not open. Check browser Console and Frappe logs."),
                indicator: "red"
            });
        }
    }
    function handleActionClick(event) {
        const action = event.target.closest?.("." + ACTION_CLASS + "[data-recording-action]");
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        const menu = action.closest(MENU_SELECTOR);
        const context = menuContexts.get(menu) || {
            name: action.dataset.messageName, channel: "", subChannel: null, chatTopic: null
        };
        const kind = action.dataset.recordingAction;
        if (menu) menu.remove();
        void runAction(kind, context);
    }
    function install() {
        if (!document.body) {
            document.addEventListener("DOMContentLoaded", install, { once: true });
            return;
        }
        document.addEventListener("click", captureTrigger, true);
        document.addEventListener("click", handleActionClick, true);
        const observer = new MutationObserver(scanMenus);
        observer.observe(document.body, { childList: true, subtree: true });
        window.CCRecordingMenuIntegration = {
            installed: true,
            version: VERSION,
            refresh: scanMenus,
            clearProbeCache: () => { probeCache.clear(); probeResults.clear(); },
            debug: () => ({
                version: VERSION,
                lastTrigger,
                menuCount: document.querySelectorAll(MENU_SELECTOR).length,
                menus: Array.from(document.querySelectorAll(MENU_SELECTOR)).map(m => ({
                    messageName: menuMessageName(m),
                    injectedFor: m.dataset.ccRecordingMenuFor || null,
                    actionCount: m.querySelectorAll("." + ACTION_CLASS + "[data-recording-action]").length
                })),
                featuresLoaded: !!window.CCRecordingFeatures,
                probes: Array.from(probeResults.entries()).slice(-10)
            })
        };
        scanMenus();
        startRecordingCheckboxes();
    }
    install();
})(window, document);
