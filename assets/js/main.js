/**
 * ביובית בדרום — main.js
 * No external dependencies. Handles: config injection, tracking stubs,
 * scroll-reveal animations, and the contact form fallback flow.
 */
(function () {
  "use strict";

  var CFG = window.SITE_CONFIG || {};

  /* ----------------------------------------------------------
     1. Inject business details wherever the markup asks for them
     ---------------------------------------------------------- */
  function applyConfig() {
    var isPlaceholder = function (v) {
      return !v || /^REPLACE_/.test(v);
    };

    // Phone links
    var phoneReady = !isPlaceholder(CFG.phoneE164);
    document.querySelectorAll("[data-role='phone-link']").forEach(function (el) {
      if (phoneReady) {
        el.setAttribute("href", "tel:" + CFG.phoneE164);
      } else {
        el.setAttribute("href", "#contact-form");
        el.setAttribute("data-phone-pending", "true");
      }
    });
    document.querySelectorAll("[data-role='phone-display']").forEach(function (el) {
      if (!isPlaceholder(CFG.phoneDisplay)) el.textContent = CFG.phoneDisplay;
    });

    // WhatsApp links
    var waReady = !isPlaceholder(CFG.whatsappNumber);
    document.querySelectorAll("[data-role='whatsapp-link']").forEach(function (el) {
      if (waReady) {
        var text = encodeURIComponent(el.getAttribute("data-wa-text") || CFG.whatsappPrefillText || "");
        el.setAttribute("href", "https://wa.me/" + CFG.whatsappNumber + (text ? "?text=" + text : ""));
      } else {
        el.setAttribute("href", "#contact-form");
        el.setAttribute("data-whatsapp-pending", "true");
      }
    });

    // Business name
    document.querySelectorAll("[data-role='business-name']").forEach(function (el) {
      el.textContent = CFG.businessName || "ביובית בדרום";
    });

    // Service areas
    var areasList = document.querySelector("[data-role='areas-list']");
    var areasFallback = document.querySelector("[data-role='areas-fallback']");
    if (CFG.serviceAreas && CFG.serviceAreas.length && areasList) {
      areasList.innerHTML = "";
      CFG.serviceAreas.forEach(function (area) {
        var li = document.createElement("li");
        li.textContent = area;
        areasList.appendChild(li);
      });
      areasList.hidden = false;
      if (areasFallback) areasFallback.hidden = true;
    } else {
      if (areasList) areasList.hidden = true;
      if (areasFallback) areasFallback.hidden = false;
    }

    // Hours (only if provided)
    var hoursEl = document.querySelector("[data-role='hours']");
    if (hoursEl) {
      if (CFG.hours) {
        hoursEl.textContent = CFG.hours;
        hoursEl.hidden = false;
      } else {
        hoursEl.hidden = true;
      }
    }

    // Google reviews link
    document.querySelectorAll("[data-role='google-reviews-link']").forEach(function (el) {
      if (CFG.googleReviewsUrl) {
        el.setAttribute("href", CFG.googleReviewsUrl);
      } else {
        el.setAttribute("aria-disabled", "true");
        el.addEventListener("click", function (e) { e.preventDefault(); });
      }
    });
  }

  /* ----------------------------------------------------------
     2. Tracking stubs — wired to gtag/fbq only if those are loaded
     ---------------------------------------------------------- */
  function trackEvent(eventName) {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", eventName);
        var label = CFG.tracking && CFG.tracking.googleAdsConversionLabels && CFG.tracking.googleAdsConversionLabels[eventName];
        if (label && CFG.tracking.googleAdsConversionId) {
          window.gtag("event", "conversion", { send_to: CFG.tracking.googleAdsConversionId + "/" + label });
        }
      }
      if (typeof window.fbq === "function") {
        window.fbq("trackCustom", eventName);
      }
    } catch (err) {
      /* tracking must never break the page */
    }
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      console.log("[track]", eventName);
    }
  }

  function wireTracking() {
    document.querySelectorAll("[data-track]").forEach(function (el) {
      el.addEventListener("click", function () {
        trackEvent(el.getAttribute("data-track"));
      });
    });
  }

  /* ----------------------------------------------------------
     3. Scroll-reveal animation (IntersectionObserver, no library)
     ---------------------------------------------------------- */
  function wireReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || !els.length) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach(function (el) { io.observe(el); });
  }

  /* ----------------------------------------------------------
     4. Contact form — posts to CFG.formEndpoint if set, otherwise
        falls back to a pre-filled WhatsApp message.
     ---------------------------------------------------------- */
  function wireForm() {
    var form = document.getElementById("contact-form-el");
    if (!form) return;
    var successEl = document.querySelector("[data-role='form-success']");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = (form.querySelector("#field-name") || {}).value || "";
      var phone = (form.querySelector("#field-phone") || {}).value || "";
      var problem = (form.querySelector("#field-problem") || {}).value || "";

      trackEvent("form_submit");

      if (CFG.formEndpoint) {
        fetch(CFG.formEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name, phone: phone, problem: problem, source: "landing-page" })
        }).catch(function () { /* fall through to WhatsApp fallback below */ });
        showSuccess();
        return;
      }

      var waReady = CFG.whatsappNumber && !/^REPLACE_/.test(CFG.whatsappNumber);
      if (waReady) {
        var msg = "פנייה חדשה מדף הנחיתה:%0Aשם: " + encodeURIComponent(name) +
          "%0Aטלפון: " + encodeURIComponent(phone) +
          "%0Aתיאור הבעיה: " + encodeURIComponent(problem);
        window.location.href = "https://wa.me/" + CFG.whatsappNumber + "?text=" + msg;
      } else {
        showSuccess();
      }
    });

    function showSuccess() {
      form.reset();
      if (successEl) successEl.classList.add("is-visible");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyConfig();
    wireTracking();
    wireReveal();
    wireForm();
  });
})();
