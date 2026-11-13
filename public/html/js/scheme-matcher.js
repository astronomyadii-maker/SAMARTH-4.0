/* VittaSetu — Government scheme matcher
 * Rules are plain data below. When a scheme changes, edit its entry in SCHEMES.
 * Last checked against published scheme details: November 2026.
 */
(function () {
  "use strict";

  const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
  const R = (state, why, todo) => ({ state: state, why: why, todo: todo || [] });

  const SCHEMES = [
    {
      id: "mudra",
      name: "PM Mudra Yojana (PMMY)",
      benefit: "Collateral-free business loans up to ₹20 lakh in four tiers: Shishu to ₹50,000, Kishor to ₹5 lakh, Tarun to ₹10 lakh, Tarun Plus to ₹20 lakh.",
      link: "https://www.mudra.org.in",
      check: function (p) {
        const a = p.amount;
        if (a > 2000000) return R("no", "Your need is above the ₹20 lakh Mudra ceiling. A regular MSME business loan may fit better.");
        if (a > 1000000 && !p.repaid) {
          return R("maybe", "Tarun Plus (₹10–20 lakh) is only for people who already repaid a Tarun loan.", ["Ask for up to ₹10 lakh now, then move up after you repay."]);
        }
        const tier = a <= 0 ? "" : a <= 50000 ? "Shishu" : a <= 500000 ? "Kishor" : a <= 1000000 ? "Tarun" : "Tarun Plus";
        return R("match",
          a > 0 ? "A " + inr(a) + " loan falls in the " + tier + " tier." : "Works for new and existing small businesses in trade, services and manufacturing.",
          ["Apply at a bank, NBFC or microfinance lender, or through jansamarth.in.",
           p.udyam ? "Keep your Udyam certificate ready." : "Get a free Udyam certificate first. Lenders prefer it for the larger tiers."]);
      },
    },
    {
      id: "svanidhi",
      name: "PM SVANidhi",
      benefit: "Collateral-free working-capital loans for street vendors: up to ₹15,000, then ₹25,000, then ₹50,000 as you repay. Digital-payment cashback is included.",
      link: "https://pmsvanidhi.mohua.gov.in",
      check: function (p) {
        if (p.activity !== "vending") return R("no", "Made for street vendors only.");
        if (p.age < 18) return R("no", "You must be at least 18.");
        return p.vendCert
          ? R("match", "You are a street vendor with a vending certificate or ID.", ["Apply for the first tranche on the PM SVANidhi portal or at a bank branch.", "Link your mobile number to your Aadhaar."])
          : R("maybe", "You qualify as a street vendor, but you need proof from your municipality.", ["Ask your urban local body for a vending certificate, ID card, or a Letter of Recommendation."]);
      },
    },
    {
      id: "pmegp",
      name: "PMEGP (credit-linked subsidy)",
      benefit: "A bank loan for a new unit, with a government margin-money subsidy of 15% to 35% of the project cost.",
      link: "https://www.kviconline.gov.in/pmegpeportal",
      check: function (p) {
        if (p.age < 18) return R("no", "You must be at least 18.");
        if (p.stage !== "new") return R("no", "PMEGP funds new units only. Existing businesses are not eligible.");
        const special = p.gender === "Female" || p.social !== "General";
        const rate = special ? (p.area === "rural" ? 35 : 25) : p.area === "rural" ? 25 : 15;
        const cap = p.activity === "manufacturing" ? 5000000 : 2000000;
        let why = (special ? "Special" : "General") + " category in a " + p.area + " area: " + rate + "% subsidy.";
        if (p.amount > 0) why += " On a " + inr(p.amount) + " project that is about " + inr(Math.min(p.amount, cap) * rate / 100) + ".";
        const todo = ["Apply on the PMEGP e-portal. A bank sanctions the loan.", "Training (EDP) is required before the first loan instalment."];
        if (p.amount > cap) todo.push("Costs above " + inr(cap) + " get no subsidy on the extra amount.");
        return R("match", why, todo);
      },
    },
    {
      id: "vishwakarma",
      name: "PM Vishwakarma",
      benefit: "For traditional artisans and craftspeople: skill training with a stipend, a toolkit grant, and collateral-free credit at a low interest rate.",
      link: "https://pmvishwakarma.gov.in",
      check: function (p) {
        if (p.activity !== "artisan") return R("no", "Made for traditional trades such as carpenter, potter, tailor, blacksmith and similar.");
        if (p.age < 18) return R("no", "You must be at least 18.");
        return R("maybe", "Your work is a traditional craft. The trade must be on the scheme's official list.", ["Check your trade on the PM Vishwakarma portal.", "Register at a Common Service Centre or online."]);
      },
    },
    {
      id: "cgtmse",
      name: "CGTMSE credit guarantee",
      benefit: "A government-backed guarantee, so banks can lend to small businesses without asking for collateral or a third-party guarantor.",
      link: "https://www.cgtmse.in",
      check: function (p) {
        if (p.activity === "vending") return R("no", "Street vendors are better served by PM SVANidhi.");
        if (!(p.amount > 0)) return R("maybe", "Enter the loan amount you need to see if this applies.");
        return R("match", "Your bank can cover a " + inr(p.amount) + " loan under this guarantee.",
          ["Ask the bank for a loan under CGTMSE cover. You do not apply to CGTMSE directly.",
           p.udyam ? "Keep your Udyam certificate ready." : "Get a free Udyam certificate. Banks usually ask for it."]);
      },
    },
    {
      id: "udyam",
      name: "Udyam registration",
      benefit: "A free government registration for micro, small and medium businesses. Many other schemes and lenders ask for it.",
      link: "https://udyamregistration.gov.in",
      check: function (p) {
        return p.udyam
          ? R("done", "You already have it.", ["Keep your certificate handy when you apply for any scheme."])
          : R("match", "Open to every kind of business and costs nothing.", ["Register online with your Aadhaar and PAN.", "Never pay anyone for it. The official portal is free."]);
      },
    },
    {
      id: "startup",
      name: "Startup India (DPIIT recognition)",
      benefit: "Recognition that unlocks tax benefits, easier compliance and access to government startup funds.",
      link: "https://www.startupindia.gov.in",
      check: function (p) {
        if (p.type === "proprietorship") return R("no", "Needs a registered private limited company, LLP or partnership firm.");
        if (p.stage === "gt10") return R("no", "Recognition is for businesses less than 10 years old.");
        if (p.activity === "vending" || p.activity === "artisan") return R("no", "Meant for innovative, scalable ventures.");
        return R("maybe", "Your structure and age are fine. You must also show an innovative product or service.", ["Register your company or LLP first if you have not.", "Apply for DPIIT recognition on the Startup India portal."]);
      },
    },
    {
      id: "social",
      name: "Social security: APY, PMSBY, PMJJBY",
      benefit: "Low-cost pension and insurance. Accident cover of ₹2 lakh costs about ₹20 a year. Life cover of ₹2 lakh costs about ₹436 a year.",
      link: "https://jansuraksha.gov.in",
      check: function (p) {
        if (p.age < 18) return R("no", "You must be at least 18.");
        if (p.age > 70) return R("no", "These schemes cover people up to age 70.");
        const fit = ["PMSBY (accident cover)"];
        if (p.age <= 50) fit.push("PMJJBY (life cover)");
        if (p.age <= 40) fit.push("APY (pension)");
        return R("match", "At your age you can take: " + fit.join(", ") + ".", ["You need a savings bank account.", "Enrol at your bank or through net banking."]);
      },
    },
  ];

  const LABEL = { match: "Likely eligible", maybe: "Check the details", done: "Already done", no: "Not a match" };

  function h(tag, props) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (props[k] == null || props[k] === false) return;
        if (k === "class") node.className = props[k];
        else if (k === "text") node.textContent = props[k];
        else node.setAttribute(k, props[k]);
      });
    }
    for (let i = 2; i < arguments.length; i++) if (arguments[i] != null) node.append(arguments[i]);
    return node;
  }

  function card(s, r) {
    const el = h("article", { class: "card scheme" },
      h("div", { class: "scheme-top" },
        h("h3", { text: s.name }),
        h("span", { class: "badge badge-" + r.state, text: LABEL[r.state] })),
      h("p", { class: "benefit", text: s.benefit }),
      h("p", { class: "why", text: r.why }));
    if (r.todo.length) {
      const ul = h("ul", { class: "todo" });
      r.todo.forEach(function (t) { ul.append(h("li", { text: t })); });
      el.append(ul);
    }
    if (r.state !== "no") {
      el.append(h("a", { class: "official", href: s.link, target: "_blank", rel: "noopener noreferrer", text: "Official site: " + s.name }));
    }
    return el;
  }

  function readForm() {
    const v = (id) => document.getElementById(id).value;
    const c = (id) => document.getElementById(id).checked;
    return {
      type: v("type"), activity: v("activity"), stage: v("stage"),
      age: Number(v("age")), gender: v("gender"), social: v("social"), area: v("area"),
      amount: v("amount") === "" ? 0 : Number(v("amount")),
      udyam: c("udyam"), vendCert: c("vendCert"), repaid: c("repaid"),
    };
  }

  function show(p) {
    const out = document.getElementById("results");
    out.replaceChildren();
    const rows = SCHEMES.map((s) => ({ s: s, r: s.check(p) }));
    const pick = (st) => rows.filter((x) => x.r.state === st);
    const good = pick("match"), maybe = pick("maybe"), done = pick("done"), no = pick("no");

    out.append(h("p", { class: "summary",
      text: good.length + " likely " + (good.length === 1 ? "match" : "matches") +
        (maybe.length ? ", " + maybe.length + " to check" : "") + "." }));
    good.concat(maybe, done).forEach((x) => out.append(card(x.s, x.r)));

    if (no.length) {
      const d = h("details", { class: "others" }, h("summary", { text: "Not a match for your answers (" + no.length + ")" }));
      no.forEach((x) => d.append(card(x.s, x.r)));
      out.append(d);
    }
    out.append(h("p", { class: "note",
      text: "This is a guide based on published scheme rules, last checked November 2026. Banks and departments make the final decision, and rules change, so confirm on the official site before you apply." }));
    out.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  const form = document.getElementById("match-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const p = readForm();
      const err = document.getElementById("error");
      if (!Number.isInteger(p.age) || p.age < 1 || p.age > 120) { err.textContent = "Enter your age as a whole number."; return; }
      if (!(p.amount >= 0)) { err.textContent = "Enter the loan amount as a number, or leave it empty."; return; }
      err.textContent = "";
      show(p);
    });
  }

  window.VittaSchemes = { SCHEMES: SCHEMES, match: (p) => SCHEMES.map((s) => Object.assign({ id: s.id, name: s.name }, s.check(p))) };
})();
