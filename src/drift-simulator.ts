const basis = performance.timeOrigin;
let drift = 21600000;

Object.defineProperty(performance, "timeOrigin", {
  get() {
    return basis - drift;
  },
  set(value) {
    drift = value - basis;
  },
  configurable: true,
  enumerable: true
});

const outputDateNow = document.getElementById("date-now-value");
const outputPerformanceNow = document.getElementById("performance-value");

document.addEventListener("input", (event) => {
  if ((event.target as HTMLElement).classList.contains("js-drift-value")) {
    drift = parseInt((event.target as HTMLInputElement).value, 10);
  }
});

setInterval(() => {
  outputDateNow.innerText = new Date(Date.now()).toISOString();
  outputPerformanceNow.innerText = new Date(
    performance.timeOrigin + performance.now()
  ).toISOString();
}, 1000);
