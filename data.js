/*
 * Specter Prototype — project data
 *
 * This file is the single source of truth for the site. Edit the values
 * below to reflect real progress, then refresh index.html (or commit +
 * push if hosting on GitHub Pages) to see the update.
 *
 * Status values used throughout: "not-started" | "in-progress" | "blocked" | "complete"
 * Task status values: "todo" | "in-progress" | "done"
 * Priority values: "low" | "medium" | "high"
 */

const DATA = {
  meta: {
    company: "Specter",
    carName: "Car No. 1",
    tagline: "Tasks and Bench Tracker",
    updated: "2026-09-23",
    // Change this to whatever you want the site's password to be.
    // Anyone entering it correctly stays unlocked on that browser/device.
    sharedPassword: "rarebirds",
  },

  // Major vehicle systems for Car No. 1
  systems: [
    {
      id: "chassis",
      name: "Chassis & Frame",
      category: "Structure",
      status: "in-progress",
      progress: 20,
      notes: "Define frame architecture and material spec.",
    },
    {
      id: "suspension",
      name: "Suspension & Steering",
      category: "Chassis",
      status: "not-started",
      progress: 0,
      notes: "Geometry TBD, depends on chassis hardpoints.",
    },
    {
      id: "brakes",
      name: "Braking System",
      category: "Chassis",
      status: "not-started",
      progress: 0,
      notes: "",
    },
    {
      id: "powertrain",
      name: "Powertrain",
      category: "Drivetrain",
      status: "not-started",
      progress: 0,
      notes: "Motor/engine + transmission selection outstanding.",
    },
    {
      id: "electrical",
      name: "Electrical & Wiring",
      category: "Electrical",
      status: "not-started",
      progress: 0,
      notes: "Wiring harness plan, ECU/battery management.",
    },
    {
      id: "body",
      name: "Body & Aero",
      category: "Exterior",
      status: "not-started",
      progress: 0,
      notes: "Surfacing, panel gaps, aero targets.",
    },
    {
      id: "interior",
      name: "Interior & Safety",
      category: "Interior",
      status: "not-started",
      progress: 0,
      notes: "Seats, harness, roll protection, controls layout.",
    },
  ],

  // Tooling & machinery needed to build the car
  tooling: [
    {
      id: "weld-table",
      name: "Welding Table & Fixtures",
      status: "in-progress",
      progress: 30,
      notes: "Table acquired, tube-notching fixtures in progress.",
    },
    {
      id: "chassis-jig",
      name: "Chassis Build Jig",
      status: "not-started",
      progress: 0,
      notes: "Needed before frame fabrication can start.",
    },
    {
      id: "cnc",
      name: "CNC Router / Mill",
      status: "not-started",
      progress: 0,
      notes: "",
    },
    {
      id: "3dprint",
      name: "3D Printer(s)",
      status: "complete",
      progress: 100,
      notes: "Operational — used for jigs, fixtures, and mockups.",
    },
    {
      id: "paint-booth",
      name: "Paint / Finishing Area",
      status: "not-started",
      progress: 0,
      notes: "",
    },
    {
      id: "lift",
      name: "Vehicle Lift",
      status: "not-started",
      progress: 0,
      notes: "",
    },
  ],

  // Processes / SOPs being developed for the company, not just the car
  processes: [
    {
      id: "fab-sop",
      name: "Fabrication SOPs",
      status: "in-progress",
      notes: "Documenting weld & assembly procedures as they're developed.",
    },
    {
      id: "qa-checklist",
      name: "QA / Inspection Checklists",
      status: "not-started",
      notes: "",
    },
    {
      id: "vendor-sourcing",
      name: "Vendor & Parts Sourcing Process",
      status: "in-progress",
      notes: "Tracking suppliers for raw materials and off-the-shelf parts.",
    },
    {
      id: "documentation",
      name: "Documentation & Version Control Workflow",
      status: "in-progress",
      notes: "This site + git repo is the first piece of it.",
    },
  ],

  // Build log / journal — most recent first
  log: [
    {
      date: "2026-09-23",
      title: "Project tracker created",
      body: "Stood up this site to track Car No. 1 progress, tooling/machinery development, process work, and open tasks.",
    },
  ],
};
