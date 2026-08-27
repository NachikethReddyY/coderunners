import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { HabitRow } from "./HabitRow";

it("toggles the completed state", async () => {
  function Harness() {
    const [completed, setCompleted] = useState(false);
    return (
      <HabitRow
        completed={completed}
        label="Morning walk"
        onToggle={setCompleted}
      />
    );
  }

  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /morning walk/i }));
  expect(screen.getByText("Completed")).toBeTruthy();
});
