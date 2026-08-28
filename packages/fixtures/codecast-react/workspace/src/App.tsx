import { useState } from "react";

import { formatHabitLabel } from "./formatHabitLabel";

export function App() {
  const [name, setName] = useState("Read");
  const label = formatHabitLabel(name);

  return (
    <main>
      <p className="eyebrow">TypeScript basics</p>
      <h1>Habit label</h1>
      <label htmlFor="habit-name">Habit name</label>
      <input id="habit-name" onChange={(event) => setName(event.target.value)} value={name} />
      <output>{label || "Your formatted label will appear here."}</output>
    </main>
  );
}
