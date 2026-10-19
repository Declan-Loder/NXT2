// =====================================================
// NXT TOURNAMENT DATA - EDIT THIS FILE TO UPDATE STATS
// After editing, push to GitHub → deploy updates automatically
// =====================================================

// TEAZERS FC 26 — Knockout Stage · Season 1
const tournamentTitle = "TEAZERS FC 26 — Knockout Stage · Season 1";
const tournamentSubtitle = "Free Entry · One Champion · Presented by TEAZERS_0";

// GROUP STANDINGS (final group stage — top 2 advance)
const groups = {
  A: [
    { pos: 1, player: "mrmo1406",         p: 3, w: 2, d: 0, l: 1, gd: "+15", pts: 6 },
    { pos: 2, player: "antisocialicon",   p: 3, w: 2, d: 0, l: 1, gd: "-2",  pts: 6 },
    { pos: 3, player: "LilScooteryard",   p: 2, w: 1, d: 0, l: 1, gd: "+2",  pts: 3 },
    { pos: 4, player: "teiyush12",        p: 2, w: 1, d: 0, l: 1, gd: "-2",  pts: 3 }
  ],
  B: [
    { pos: 1, player: "CreamySuspect",    p: 3, w: 3, d: 0, l: 0, gd: "+22", pts: 9 },
    { pos: 2, player: "shaqlebussdown",   p: 3, w: 1, d: 0, l: 2, gd: "-13", pts: 3 },
    { pos: 3, player: "oknotfound",       p: 2, w: 0, d: 0, l: 2, gd: "-6",  pts: 0 },
    { pos: 4, player: "Recce231711",      p: 2, w: 0, d: 0, l: 2, gd: "-6",  pts: 0 }
  ],
  C: [
    { pos: 1, player: "creamilicious91",  p: 3, w: 3, d: 0, l: 0, gd: "+10", pts: 9 },
    { pos: 2, player: "JustJxred",        p: 3, w: 2, d: 0, l: 1, gd: "+13", pts: 6 },
    { pos: 3, player: "kaedryng9",        p: 2, w: 1, d: 0, l: 1, gd: "+3",  pts: 3 },
    { pos: 4, player: "JoshyMoses",       p: 2, w: 0, d: 0, l: 2, gd: "-17", pts: 0 }
  ],
  D: [
    { pos: 1, player: "jezz_gitau1",      p: 3, w: 3, d: 0, l: 0, gd: "+11", pts: 9 },
    { pos: 2, player: "Funnyjump160",     p: 3, w: 2, d: 0, l: 1, gd: "+10", pts: 6 },
    { pos: 3, player: "slightly-hill24",  p: 2, w: 0, d: 0, l: 2, gd: "-6",  pts: 0 },
    { pos: 4, player: "20nathan11",       p: 2, w: 0, d: 0, l: 2, gd: "-15", pts: 0 }
  ]
};

// Qualified for knockout (top 2 each group)
const knockoutQualifiers = {
  A1: "mrmo1406",
  A2: "antisocialicon",
  B1: "CreamySuspect",
  B2: "shaqlebussdown",
  C1: "creamilicious91",
  C2: "JustJxred",
  D1: "jezz_gitau1",
  D2: "Funnyjump160"
};

// ONLY TEAZERS FC 26 for now
const upcomingEvents = [
  {
    status: "Knockout stage",
    title: "TEAZERS FC 26 — Season 1",
    meta: "Quarter-finals · Free entry · One champion",
    desc: "Top 2 from each group · 8 players · Presented by TEAZERS_0",
    open: false
  }
];
