"use client";

import { useEffect, useRef, useState } from "react";
import { lessMotion } from "./motion";
import { createGame, MAX_SCORE, type Side, type SideStats } from "./engine";

const blank: SideStats = { goals: 0, streak: 0, bestStreak: 0, topSpeed: 0, powerHits: 0 };
const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);

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
  const [stats, setStats] = useState<Record<Side, SideStats>>({ p: blank, cpu: blank });
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

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!MOVE_KEYS.has(event.code) || phase !== "play") return;
    event.preventDefault();
    game.current?.keyDown(event.code);
  };
  const onKeyUp = (event: React.KeyboardEvent) => game.current?.keyUp(event.code);
  const onBlur = () => MOVE_KEYS.forEach((k) => game.current?.keyUp(k));

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

  return (
    <div className={`hockey is-${phase}`}>
      {panel("p")}

      <div className="hockey__arena">
        <canvas
          ref={canvas}
          className="hockey__table"
          tabIndex={0}
          role="application"
          aria-label={`Air hockey table. You ${score.p}, CPU ${score.cpu}. Move with the mouse, touch, or the arrow keys.`}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={onBlur}
        />

        {phase !== "play" && (
          <div className="hockey__screen">
            {phase === "over" ? (
              <>
                <p className="hockey__result">{winner === "p" ? "You win" : "CPU wins"}</p>
                <p className="hockey__final">
                  {score.p} – {score.cpu}
                </p>
              </>
            ) : (
              <>
                <p className="hockey__result">Air hockey</p>
                <p className="hockey__final">First to {MAX_SCORE} wins</p>
              </>
            )}
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
          {phase === "over" ? `${winner === "p" ? "You win" : "CPU wins"}, ${score.p} to ${score.cpu}.` : phase === "play" ? `You ${score.p}, CPU ${score.cpu}.` : ""}
        </p>
      </div>

      {panel("cpu")}
    </div>
  );
}
