import { DomainError } from "./errors";

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly transitions: TransitionMap<S>;
  can(from: S, to: S): boolean;
  assert(from: S, to: S): void;
  next(from: S): readonly S[];
  /** Flat (from, to) pairs — used to assert parity with btg.state_transitions. */
  pairs(): Array<{ from: S; to: S }>;
}

export function createStateMachine<S extends string>(
  name: string,
  transitions: TransitionMap<S>,
): StateMachine<S> {
  const states = Object.keys(transitions) as S[];
  return {
    name,
    states,
    transitions,
    can(from, to) {
      if (from === to) return true;
      return (transitions[from] ?? []).includes(to);
    },
    assert(from, to) {
      if (!this.can(from, to)) throw DomainError.invalidTransition(name, from, to);
    },
    next(from) {
      return transitions[from] ?? [];
    },
    pairs() {
      return states.flatMap((from) => (transitions[from] ?? []).map((to) => ({ from, to })));
    },
  };
}
