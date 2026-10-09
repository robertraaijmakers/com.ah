"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Navbar from "react-bootstrap/Navbar";
import NavLink from "react-bootstrap/NavLink";
import NavDropdown from "react-bootstrap/NavDropdown";
import Container from "react-bootstrap/Container";
import Nav from "react-bootstrap/Nav";
import Offcanvas from "react-bootstrap/Offcanvas";
import ListGroup from "react-bootstrap/ListGroup";

const mainLinks = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/plans", label: "Plannen", icon: "📅" },
  { href: "/shopping", label: "Boodschappen", icon: "🛒" },
  { href: "/pantry", label: "Voorraad", icon: "🥫" },
  { href: "/meals", label: "Recepten", icon: "🍳" },
  { href: "/products", label: "Producten", icon: "🏷️" },
  { href: "/advice", label: "Prijsalerts", icon: "💶" },
  { href: "/analytics", label: "Analytics", icon: "📊" },
];

const settingsLinks = [
  { href: "/family", label: "Familie", icon: "👨‍👩‍👧" },
  { href: "/settings", label: "Instellingen", icon: "⚙️" },
];

// Bottom tab bar on phones: the four things you use daily, everything else under "Meer"
const tabHrefs = ["/", "/plans", "/shopping", "/pantry"];

function isActive(path: string, href: string) {
  return path === href || (href !== "/" && path.startsWith(href + "/"));
}

export default function AppNav() {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const settingsActive = settingsLinks.some((l) => isActive(path, l.href));
  const tabs = mainLinks.filter((l) => tabHrefs.includes(l.href));
  const moreLinks = [...mainLinks.filter((l) => !tabHrefs.includes(l.href)), ...settingsLinks];
  const moreActive = moreLinks.some((l) => isActive(path, l.href));

  return (
    <>
      {/* Top bar: full menu on large screens, just the brand on phones */}
      <Navbar expand="lg" className="navbar-ah navbar-dark shadow-sm sticky-top">
        <Container>
          <Navbar.Brand as={Link} href="/" className="fw-bold">
            AH Planner
          </Navbar.Brand>
          <Nav className="me-auto d-none d-lg-flex flex-row">
            {mainLinks.map((l) => (
              <NavLink
                key={l.href}
                as={Link}
                href={l.href}
                className={`nav-link-ah px-2 py-1 mx-0 ${isActive(path, l.href) ? "active" : ""}`}
              >
                {l.label}
              </NavLink>
            ))}
            <NavDropdown
              title="Beheer"
              id="settings-dropdown"
              className={`nav-link-ah ${settingsActive ? "active" : ""}`}
            >
              {settingsLinks.map((l) => (
                <NavDropdown.Item key={l.href} as={Link} href={l.href} active={isActive(path, l.href)}>
                  {l.label}
                </NavDropdown.Item>
              ))}
            </NavDropdown>
          </Nav>
        </Container>
      </Navbar>

      {/* Bottom tab bar (phones / small tablets) */}
      <nav className="navbar fixed-bottom bg-white border-top d-lg-none p-0 tabbar d-print-none" aria-label="Hoofdmenu">
        <ul className="nav nav-fill w-100 flex-nowrap">
          {tabs.map((l) => (
            <li className="nav-item" key={l.href}>
              <Link href={l.href} className={`nav-link tab-link ${isActive(path, l.href) ? "active" : ""}`} aria-current={isActive(path, l.href) ? "page" : undefined}>
                <span className="tab-icon" aria-hidden="true">{l.icon}</span>
                <span className="tab-label">{l.label}</span>
              </Link>
            </li>
          ))}
          <li className="nav-item">
            <button type="button" className={`nav-link tab-link w-100 ${moreActive ? "active" : ""}`} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
              <span className="tab-icon" aria-hidden="true">☰</span>
              <span className="tab-label">Meer</span>
            </button>
          </li>
        </ul>
      </nav>

      <Offcanvas show={moreOpen} onHide={() => setMoreOpen(false)} placement="bottom" className="more-sheet">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title className="h6">Menu</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="pt-0">
          <ListGroup variant="flush">
            {moreLinks.map((l) => (
              <ListGroup.Item
                key={l.href}
                as={Link}
                href={l.href}
                action
                active={isActive(path, l.href)}
                onClick={() => setMoreOpen(false)}
                className="py-3"
              >
                <span className="me-3" aria-hidden="true">{l.icon}</span>
                {l.label}
              </ListGroup.Item>
            ))}
          </ListGroup>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
