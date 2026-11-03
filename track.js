// track.js – anonymous visitor counts with GoatCounter (no cookies, nothing stored on the visitor's device).
// Dashboard: https://sebaweb.goatcounter.com
//
// The counts are sent by hand (setting no_onload), so that every page and action gets the language:
//   trackPage()                       e.g. "/simulator.html?variant=binary (NL)"
//   trackEvent("simulation started")  e.g. "simulation started (binary, NL)"
// Visits from the own computer (localhost) are not counted by GoatCounter.
(function () {
    var queue = [];
    var lang = function () {
        var l = (document.documentElement.lang || "nl").toLowerCase().slice(0, 2);
        return l === "en" || l === "es" ? l.toUpperCase() : "NL";
    };
    // the page name without the folder it is in on the server, so that the counts stay the same after a move
    var page = function () {
        var name = location.pathname.split("/").pop() || "index.html";
        var variant = new URLSearchParams(location.search).get("variant");
        if (name === "index.html") {
            return "/";
        }
        return "/" + name + (variant ? "?variant=" + variant : "");
    };
    var variant = function () {
        var v = new URLSearchParams(location.search).get("variant");
        return v === "single" ? "single star" : v ? "binary" : "";
    };
    var send = function (data) {
        if (window.goatcounter && window.goatcounter.count) {
            window.goatcounter.count(data);
        } else {
            queue.push(data); // count.js has not loaded yet
        }
    };
    // called when count.js has loaded (onload of its script tag)
    window.gcReady = function () {
        while (queue.length) {
            send(queue.shift());
        }
    };
    window.trackPage = function (opts) {
        var withLang = !(opts && opts.noLang);
        send({ path: page() + (withLang ? " (" + lang() + ")" : ""), title: document.title });
    };
    window.trackEvent = function (what, opts) {
        var parts = [];
        if (variant()) {
            parts.push(variant());
        }
        if (!(opts && opts.noLang)) {
            parts.push(lang());
        }
        send({ path: what + (parts.length ? " (" + parts.join(", ") + ")" : ""), title: what, event: true });
    };
})();
