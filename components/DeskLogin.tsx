"use client";

import { useEffect, useState } from "react";

type LoginBackground = {
  src: string;
  title: string;
  year: string;
  credit: string;
  sourceUrl: string;
  position: string;
};

const LOGIN_BACKGROUNDS: LoginBackground[] = [
  {
    src: "/login-backgrounds/ortelius-world-map-1570.jpg",
    title: "Typus Orbis Terrarum",
    year: "1570",
    credit: "Abraham Ortelius / Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:OrteliusWorldMap1570.jpg",
    position: "center 46%",
  },
  {
    src: "/login-backgrounds/fra-mauro-map.jpg",
    title: "Fra Mauro world map",
    year: "c. 1450",
    credit: "Fra Mauro / Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:FraMauroDetailedMap.jpg",
    position: "center",
  },
  {
    src: "/login-backgrounds/carta-marina.png",
    title: "Carta Marina",
    year: "1539",
    credit: "Olaus Magnus / Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:CartaMarina.png",
    position: "center 42%",
  },
  {
    src: "/login-backgrounds/celestial-planisphere-1835.jpg",
    title: "A celestial planisphere",
    year: "1835",
    credit: "Library of Congress / Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:A_celestial_planisphere,_or_map_of_the_heavens_LOC_2013593157.jpg",
    position: "center",
  },
  {
    src: "/login-backgrounds/cellarius-planisphaerium-copernicanum.jpg",
    title: "Planisphaerium Copernicanum",
    year: "1660",
    credit: "Andreas Cellarius / Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Cellarius_Harmonia_Macrocosmica_-_Planisphaerium_Copernicanum.jpg",
    position: "center",
  },
  {
    src: "/login-backgrounds/cellarius-scenographia-copernicani.jpg",
    title: "Scenographia Systematis Copernicani",
    year: "1660",
    credit: "Andreas Cellarius / Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Cellarius_Harmonia_Macrocosmica_-_Scenographia_Systematis_Copernicani.jpg",
    position: "center",
  },
];

function nextRandomIndex(current: number) {
  if (LOGIN_BACKGROUNDS.length < 2) return 0;
  let next = Math.floor(Math.random() * LOGIN_BACKGROUNDS.length);
  while (next === current) next = Math.floor(Math.random() * LOGIN_BACKGROUNDS.length);
  return next;
}

type DeskLoginProps = {
  email: string;
  password: string;
  error: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
};

export default function DeskLogin({
  email,
  password,
  error,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: DeskLoginProps) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((current) => nextRandomIndex(current));
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

  const current = LOGIN_BACKGROUNDS[active];

  return (
    <main className="desk-login-shell">
      <div className="desk-login-bg" aria-hidden="true">
        {LOGIN_BACKGROUNDS.map((bg, index) => (
          <div
            key={bg.src}
            className={`desk-login-slide${index === active ? " active" : ""}`}
            style={{ backgroundImage: `url(${bg.src})`, backgroundPosition: bg.position }}
          />
        ))}
        <div className="desk-login-vignette" />
      </div>

      <section className="desk-login-panel" aria-labelledby="desk-login-title">
        <span className="desk-login-kicker">Terraveler · Editorial desk</span>
        <h1 id="desk-login-title">Sign in</h1>

        <a href="/api/desk/google" className="desk-btn desk-btn-primary desk-login-google">
          Sign in with Google
        </a>

        <div className="desk-login-divider">
          <span>or with email</span>
        </div>

        <form onSubmit={onSubmit} className="desk-login-form">
          <input
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="email"
            type="email"
            autoComplete="username"
            className="desk-input"
          />
          <input
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="password"
            type="password"
            autoComplete="current-password"
            className="desk-input"
          />
          <button type="submit" className="desk-btn desk-btn-primary">Enter the desk</button>
          {error && <div className="desk-login-error">{error}</div>}
        </form>
      </section>

      <p className="desk-login-credit">
        <a href={current.sourceUrl} target="_blank" rel="noreferrer">
          {current.title}
        </a>
        {" "}· {current.year} · {current.credit}
      </p>
    </main>
  );
}
