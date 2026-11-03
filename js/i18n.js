(function() {
    const messages = window.I18N_MESSAGES || { en: {}, ru: {} };
    let currentLang = "ru";

    function setLang(lang) {
        currentLang = messages[lang] ? lang : "ru";
        try {
            localStorage.setItem("meshmill.lang", currentLang);
        } catch (err) {
            // ignore storage errors
        }
    }

    function getLang() {
        return currentLang;
    }

    function t(key) {
        const args = Array.prototype.slice.call(arguments, 1);
        let str = (messages[currentLang] && messages[currentLang][key]);
        if (str === undefined && messages.en) {
            str = messages.en[key];
        }
        if (str === undefined) {
            str = key;
        }
        return str.replace(/\{(\d+)\}/g, function(match, idx) {
            return args[idx] !== undefined ? args[idx] : match;
        });
    }

    function apply(root) {
        const scope = root || document;

        scope.querySelectorAll("[data-i18n]").forEach(function(el) {
            const key = el.getAttribute("data-i18n");
            const attr = el.getAttribute("data-i18n-attr");
            if (attr) {
                el.setAttribute(attr, t(key));
            } else {
                el.textContent = t(key);
            }
        });

        scope.querySelectorAll("[data-i18n-title]").forEach(function(el) {
            el.title = t(el.getAttribute("data-i18n-title"));
        });

        scope.querySelectorAll("[data-i18n-placeholder]").forEach(function(el) {
            el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
        });
    }

    // Start with the stored language, or Russian by default.
    try {
        const stored = localStorage.getItem("meshmill.lang");
        if (stored && messages[stored]) currentLang = stored;
    } catch (err) {
        // ignore storage errors
    }

    window.i18n = {
        t: t,
        apply: apply,
        setLang: setLang,
        getLang: getLang,
    };

    document.addEventListener("DOMContentLoaded", function() {
        apply(document);
    });
})();
