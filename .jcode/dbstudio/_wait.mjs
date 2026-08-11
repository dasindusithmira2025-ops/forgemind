// Coordinator helper: block for N seconds so the swarm can make progress between polls.
const seconds = Number(process.argv[2] || 300);
setTimeout(() => {
  console.log(`waited ${seconds}s`);
}, seconds * 1000);
