// проверяем, что в объёмной раскладке селект «Картинка на задник» заблокирован
const out = {};
const fill = document.getElementById("fill");
const art = document.getElementById("artMode");
const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));

out.initial = { fill: fill.value, artDisabled: art.disabled, title: art.title };

fill.value = "flat";
fire(fill, "change");
out.flat = { fill: fill.value, artDisabled: art.disabled, title: art.title };

fill.value = "box";
fire(fill, "change");
out.box = { fill: fill.value, artDisabled: art.disabled, title: art.title };

// и что это переживает перезагрузку настроек
out.stored = JSON.parse(localStorage.getItem("diobox.v1") || "{}");
return out;
