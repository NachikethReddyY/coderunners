type HabitRowProps = {
  completed: boolean;
  label: string;
  onToggle(nextCompleted: boolean): void;
};

export function HabitRow({ completed, label, onToggle }: HabitRowProps) {
  return (
    <button
      aria-pressed={completed}
      onClick={() => {
        // TODO: Learner-owned toggle state transition.
        void onToggle;
      }}
      type="button"
    >
      <span>{label}</span>
      <strong>{completed ? "Completed" : "Incomplete"}</strong>
    </button>
  );
}
