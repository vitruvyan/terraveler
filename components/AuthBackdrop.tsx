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

export function GoogleMark() {
  return (
    <svg className="auth-google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#fbbc05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export default function AuthBackdrop({ children, variant = "account" }: { children: React.ReactNode; variant?: "account" | "desk" }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(Math.floor(Math.random() * LOGIN_BACKGROUNDS.length));
  }, []);

  const current = LOGIN_BACKGROUNDS[active];

  return (
    <main className={`auth-shell auth-shell-${variant}`}>
      <div className="auth-backdrop" aria-hidden="true">
        <div
          className="auth-backdrop-image"
          style={{ backgroundImage: `url(${current.src})`, backgroundPosition: current.position }}
        />
        <div className="auth-backdrop-vignette" />
      </div>
      {children}
      <p className="auth-image-credit">
        <a href={current.sourceUrl} target="_blank" rel="noreferrer">{current.title}</a>
        {" "}· {current.year} · {current.credit}
      </p>
    </main>
  );
}
