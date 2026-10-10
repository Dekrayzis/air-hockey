"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { lessMotion } from "./motion";
import { blankStats, createGame, KEY_DIRECTIONS, MAX_SCORE, type Side, type SideStats } from "./engine";

const outcome = (winner: Side | null) => (winner === "p" ? "You win" : "CPU wins");

/**
 * Air hockey against the CPU, first to seven. Move your mallet with the
 * mouse, a finger, or the arrow keys / WASD once the table has focus. The
 * game itself runs on a canvas in ./engine.ts; this component owns the
 * scoreboard, the start and game-over screens and the sound switch.
 */
export function AirHockey() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<ReturnType<typeof createGame> | null>(null);
  const [score, setScore] = useState<Record<Side, number>>({ p: 0, cpu: 0 });
  const [stats, setStats] = useState<Record<Side, SideStats>>({ p: blankStats(), cpu: blankStats() });
  const [phase, setPhase] = useState<"idle" | "play" | "over">("idle");
  const [winner, setWinner] = useState<Side | null>(null);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const g = createGame(canvas.current!, {
      onStats: (s, st) => {
        setScore(s);
        setStats(st);
      },
      onOver: (w) => {
        setWinner(w);
        setPhase("over");
      },
      lessMotion,
    });
    game.current = g;
    return () => {
      g.destroy();
      game.current = null;
    };
  }, []);

  const start = () => {
    game.current?.start();
    setWinner(null);
    setPhase("play");
    canvas.current?.focus();
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    game.current?.setMuted(!next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.code in KEY_DIRECTIONS) || phase !== "play") return;
    event.preventDefault();
    game.current?.keyDown(event.code);
  };

  const panel = (side: Side) => {
    const s = stats[side];
    const name = side === "p" ? "You" : "CPU";
    return (
      <section className={`hockey__panel hockey__panel--${side}`} aria-label={`${name} stats`}>
        <h2 className="hockey__name">{name}</h2>
        <p className="hockey__score">
          {score[side]}
          <span className="sr-only"> goals</span>
        </p>
        <ol className="hockey__pips" aria-hidden="true">
          {Array.from({ length: MAX_SCORE }, (_, i) => (
            <li key={i} className={i < score[side] ? "is-on" : undefined} />
          ))}
        </ol>
        <dl className="hockey__stats">
          <div>
            <dt>Streak</dt>
            <dd>{s.streak}</dd>
          </div>
          <div>
            <dt>Best streak</dt>
            <dd>{s.bestStreak}</dd>
          </div>
          <div>
            <dt>Top speed</dt>
            <dd>{s.topSpeed}</dd>
          </div>
          <div>
            <dt>Power hits</dt>
            <dd>{s.powerHits}</dd>
          </div>
        </dl>
      </section>
    );
  };

  const announcement =
    phase === "over" ? `${outcome(winner)}, ${score.p} to ${score.cpu}.` : phase === "play" ? `You ${score.p}, CPU ${score.cpu}.` : "";

  return (
    <div className={`hockey is-${phase}`}>
      <div className="hockey__layout">
        {panel("p")}

        <div className="hockey__arena">
          <canvas
            ref={canvas}
            className="hockey__table"
            tabIndex={0}
            role="application"
            aria-label={`Air hockey table. You ${score.p}, CPU ${score.cpu}. Move with the mouse, touch, or the arrow keys.`}
            onKeyDown={onKeyDown}
            onKeyUp={(event) => game.current?.keyUp(event.code)}
            onBlur={() => game.current?.releaseKeys()}
          />

          {phase !== "play" && (
            <div className="hockey__screen">
              <p className="hockey__result">{phase === "over" ? outcome(winner) : "Air hockey"}</p>
              <p className="hockey__final">{phase === "over" ? `${score.p} – ${score.cpu}` : `First to ${MAX_SCORE} wins`}</p>
              <button type="button" className="hockey__start" onClick={start}>
                {phase === "over" ? "Play again" : "Start match"}
              </button>
            </div>
          )}

          <div className="hockey__bar">
            <p className="hockey__hint">Mouse, touch, or arrow keys · the puck speeds up every two goals</p>
            <button type="button" className="hockey__sound" aria-pressed={sound} onClick={toggleSound}>
              Sound {sound ? "on" : "off"}
            </button>
          </div>

          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </div>

        {panel("cpu")}
      </div>
    </div>
  );
}
