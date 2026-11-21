import type { Diagnostics, State } from "./physics/types.js";
import { ATM } from "./physics/thermo.js";

const W = 1100,
  H = 570;
const colors = {
  ink: "#3e6152",
  muted: "#8c9b87",
  water: "#85b4be",
  steam: "#86a58b",
  heat: "#c79862",
  line: "#bac7b5",
  paper: "#fffefa",
  pale: "#f4f6eb",
};

export function draw(canvas: HTMLCanvasElement, s: State, d: Diagnostics): void {
  const ratio = window.devicePixelRatio || 1,
    width = canvas.clientWidth;
  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((width * ratio * H) / W);
  }
  const c = canvas.getContext("2d");
  if (!c) return;
  c.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  c.clearRect(0, 0, W, H);
  c.lineCap = "round";
  c.lineJoin = "round";
  const text = (
    label: string,
    x: number,
    y: number,
    size = 13,
    color = colors.muted,
    align: CanvasTextAlign = "left",
  ): void => {
    c.fillStyle = color;
    c.font = `${size >= 20 ? "500 " : ""}${size}px "Segoe UI", Arial, sans-serif`;
    c.textAlign = align;
    c.fillText(label, x, y);
  };
  const line = (points: number[][], color: string, dashed = false, width = 2): void => {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash(dashed ? [5, 7] : []);
    c.beginPath();
    points.forEach(([x = 0, y = 0], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.stroke();
    c.setLineDash([]);
  };
  const box = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill = colors.pale,
    border = colors.line,
    radius = 8,
  ): void => {
    c.fillStyle = fill;
    c.strokeStyle = border;
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(x, y, w, h, radius);
    c.fill();
    c.stroke();
  };
  const arrow = (x: number, y: number, direction: "right" | "down" | "up", color: string): void => {
    c.save();
    c.translate(x, y);
    c.rotate(direction === "down" ? Math.PI / 2 : direction === "up" ? -Math.PI / 2 : 0);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(-5, -4);
    c.lineTo(3, 0);
    c.lineTo(-5, 4);
    c.closePath();
    c.fill();
    c.restore();
  };
  const label = (name: string, x: number, y: number): void => text(name, x, y, 11, colors.ink);
  const temp = (T: number): string => `${(T - 273.15).toFixed(0)} °C`;

  // Subtle reference grid.
  c.fillStyle = "#dfe5d7";
  for (let x = 25; x < W; x += 25)
    for (let y = 20; y < H - 20; y += 25) {
      c.beginPath();
      c.arc(x, y, 0.6, 0, 2 * Math.PI);
      c.fill();
    }

  text("SUPPLIES", 35, 48, 10);
  box(35, 65, 145, 100);
  label("COAL BUNKER", 49, 89);
  text(`${(s.bunker / 1000).toFixed(2)} t`, 49, 120, 23, colors.ink);
  for (let i = 0; i < 10; i++) box(49 + i * 11.5, 139, 7, 5 + (i % 3) * 3, "#b8b9a3", "#b8b9a3", 1);
  box(35, 195, 145, 125, "#f1f7f5", "#a9c4c4");
  label("WATER TENDER", 49, 220);
  text(`${(s.tank.mass / 1000).toFixed(2)} t`, 49, 250, 23, "#518899");
  const tankT = s.tank.mass > 0 ? s.tank.energy / s.tank.mass / 4200 : 0;
  text(`~${tankT.toFixed(0)} °C`, 49, 273, 11);
  box(49, 292, 115, 6, "#e0ebdf", "#e0ebdf", 2);
  box(49, 292, Math.max(1, (115 * s.tank.mass) / 34000), 6, colors.water, colors.water, 2);
  // Supply lines and pump.
  line(
    [
      [180, 265],
      [205, 265],
      [205, 350],
      [430, 350],
      [430, 315],
    ],
    colors.water,
  );
  box(225, 337, 29, 27, "#eef5f0", colors.water, 5);
  text("P", 239, 356, 12, "#65969b", "center");
  arrow(370, 350, "right", colors.water);
  arrow(430, 327, "up", colors.water);
  line(
    [
      [180, 113],
      [222, 113],
      [222, 245],
      [245, 245],
    ],
    "#b5b496",
    true,
  );

  // Firebox and boiler body.
  box(245, 230, 125, 155, "#faf2e5", "#c6ab82");
  label("FIREBOX", 259, 251);
  text(temp(d.fireT), 259, 281, 23, "#a7753d");
  text(`${s.fire.coal.toFixed(0)} kg coal`, 259, 303, 11);
  const lit = d.burnRate > 0.001 || d.fireT > 650;
  for (let i = 0; i < 5; i++) {
    c.fillStyle = lit ? (i % 2 ? "#d8a05d" : "#e8bf80") : "#c8c5b1";
    c.beginPath();
    c.moveTo(260 + i * 19, 367);
    c.quadraticCurveTo(263 + i * 19, 338 - (i % 2) * 10, 267 + i * 19, 343);
    c.quadraticCurveTo(283 + i * 19, 369, 260 + i * 19, 367);
    c.fill();
  }
  line(
    [
      [370, 280],
      [395, 280],
    ],
    colors.heat,
    false,
    4,
  );
  arrow(384, 280, "right", colors.heat);
  box(395, 185, 325, 145, "#f3f6ed", "#9fb49d", 14);
  c.save();
  c.beginPath();
  c.roundRect(396, 186, 323, 143, 13);
  c.clip();
  const level = d.level ?? 0.6;
  c.fillStyle = d.level === null ? "#e0e7d6" : "#d5e7e7";
  c.fillRect(396, 329 - 143 * level, 323, 143 * level);
  c.restore();
  for (let i = 0; i < 4; i++)
    line(
      [
        [413, 294 + i * 6],
        [702, 294 + i * 6],
      ],
      "#b4c5b0",
      false,
      1.2,
    );
  const tubeY = 329 - 143 * 0.28;
  line(
    [
      [397, tubeY],
      [720, tubeY],
    ],
    "#b49771",
    true,
    0.8,
  );
  label("BOILER · PRIMARY TUBES", 413, 208);
  text(`${((d.boiler.p - ATM) / 1e5).toFixed(2)} bar`, 413, 243, 27, colors.ink);
  text(temp(d.boiler.T), 413, 267, 15, "#577e6f");
  text(
    d.level === null ? "NO PHASE INTERFACE" : `WATER ${(d.level * 100).toFixed(0)}%`,
    700,
    270,
    11,
    "#62858a",
    "right",
  );
  text(`Metal ${temp(d.metalT)}`, 555, 365, 11, colors.muted, "center");
  box(610, 155, 55, 30, "#f3f6ed", "#9fb49d", 8);
  // Relief stem.
  line(
    [
      [635, 155],
      [635, 125],
      [650, 125],
    ],
    d.reliefRate > 0 ? "#b67c41" : "#a9b79f",
  );
  text("RELIEF", 634, 107, 9, d.reliefRate > 0 ? "#b67c41" : colors.muted, "center");
  if (d.reliefRate > 0 || s.controls.vent)
    for (let i = 0; i < 3; i++)
      line(
        [
          [655 + i * 7, 120],
          [658 + i * 7, 105],
        ],
        "#c2cdbb",
        true,
        1,
      );

  // Gas passage to flues and chimney. Dashed amber = heat-bearing flue gas.
  line(
    [
      [307, 230],
      [307, 135],
      [788, 135],
      [788, 169],
    ],
    colors.heat,
    true,
  );
  arrow(540, 135, "right", colors.heat);
  text("HOT FLUE GAS", 405, 121, 9, "#b18b57");
  box(760, 170, 135, 115, "#f3f4e9", "#aebb9e");
  label("SUPERHEATER", 773, 193);
  text(temp(d.steamT), 773, 224, 24, "#5a7e61");
  text(`Metal ${temp(d.superheaterT)}`, 773, 251, 10);
  line(
    [
      [665, 170],
      [735, 170],
      [735, 220],
      [760, 220],
    ],
    colors.steam,
    false,
    3,
  );
  arrow(748, 220, "right", colors.steam);
  box(723, 202, 24, 24, "#fffefa", "#91ac91", 4);
  text("T", 735, 218, 10, "#668967", "center");
  line(
    [
      [895, 202],
      [915, 202],
      [915, 305],
      [720, 305],
    ],
    colors.heat,
    true,
  );
  line(
    [
      [720, 287],
      [947, 287],
      [947, 200],
    ],
    colors.heat,
    true,
  );
  arrow(947, 221, "up", colors.heat);
  box(930, 113, 35, 89, "#f4f2e6", "#bfb598", 3);
  box(923, 104, 49, 14, "#e7e4d3", "#bfb598", 3);
  text("CHIMNEY", 947, 60, 10, colors.muted, "center");
  text(temp(d.chimneyT), 947, 83, 19, "#9a8258", "center");
  if (d.burnRate > 0.001)
    for (let i = 0; i < 3; i++) {
      c.strokeStyle = "#c7cbbd";
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(943 + i * 10, 94 - i * 15, 8 + i * 4, 4 + i * 3, -0.4, 0, 2 * Math.PI);
      c.stroke();
    }

  // Cylinder, exhaust path and optional condenser.
  line(
    [
      [825, 285],
      [825, 376],
    ],
    colors.steam,
    false,
    3,
  );
  arrow(825, 344, "down", colors.steam);
  box(758, 378, 137, 73, "#f2f5ed", "#9caf99", 7);
  label("CYLINDER", 771, 398);
  text(`${(d.power / 1000).toFixed(0)} kW`, 771, 423, 20, colors.ink);
  line(
    [
      [786, 438],
      [865, 438],
    ],
    "#9fae95",
    false,
    1,
  );
  const piston = 790 + 40 * (0.5 + 0.5 * Math.sin(s.time * Math.max(0.5, Math.abs(s.speed)) * 2));
  line(
    [
      [piston, 431],
      [piston, 446],
    ],
    "#6f886d",
    false,
    4,
  );
  line(
    [
      [piston, 439],
      [735, 439],
      [700, 466],
    ],
    "#8d9f83",
    false,
    2,
  );
  line(
    [
      [895, 415],
      [935, 415],
    ],
    "#9eafa1",
    true,
  );
  arrow(923, 415, "right", "#9eafa1");
  if (s.specs.condenser) {
    box(935, 378, 137, 73, "#edf6f4", "#a8c5c0");
    label("CONDENSER", 948, 398);
    text(`${(d.condenserHeat / 1000).toFixed(0)} kW out`, 948, 425, 15, "#6c9798");
    line(
      [
        [1002, 451],
        [1002, 514],
        [112, 514],
        [112, 320],
      ],
      colors.water,
      true,
    );
    arrow(112, 339, "up", colors.water);
    text("HOT CONDENSATE RETURN", 864, 533, 9, "#8ca7a2", "center");
  } else {
    text("EXHAUST", 952, 408, 10);
    text("to atmosphere", 952, 426, 11);
    text("Condenser off", 952, 447, 9, "#a7ac9c");
  }
  // Three coupled driving wheels and rail.
  line(
    [
      [390, 493],
      [740, 493],
    ],
    "#bfc8b4",
    false,
    2,
  );
  for (const x of [445, 550, 655]) {
    c.strokeStyle = "#96a78b";
    c.fillStyle = "#f5f6eb";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, 449, 42, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const angle = (s.time * s.speed) / 1;
    for (let j = 0; j < 8; j++) {
      const a = angle + (j * Math.PI) / 4;
      line(
        [
          [x, 449],
          [x + 36 * Math.cos(a), 449 + 36 * Math.sin(a)],
        ],
        "#c3cdb7",
        false,
        1,
      );
    }
    c.fillStyle = "#809677";
    c.beginPath();
    c.arc(x, 449, 5, 0, Math.PI * 2);
    c.fill();
  }
  line(
    [
      [445, 455],
      [655, 455],
    ],
    "#829676",
    false,
    4,
  );
  text(
    d.slipPower > 100
      ? `SLIP LOSS ${(d.slipPower / 1000).toFixed(0)} kW`
      : "COUPLED DRIVING WHEELS",
    550,
    535,
    10,
    d.slipPower > 100 ? "#b17d44" : colors.muted,
    "center",
  );
}
