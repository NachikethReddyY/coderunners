import { useState } from "react";

import { HabitRow } from "./components/HabitRow";

export function App() {
  const [completed, setCompleted] = useState(false);

  return (
    <main>
      <p>Today</p>
      <h1>Habit tracker</h1>
      <HabitRow
        completed={completed}
        label="Morning walk"
        onToggle={setCompleted}
      />
    </main>
  );
}
