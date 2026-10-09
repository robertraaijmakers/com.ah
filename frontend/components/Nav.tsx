"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Navbar from "react-bootstrap/Navbar";
import NavLink from "react-bootstrap/NavLink";
import NavDropdown from "react-bootstrap/NavDropdown";
import Container from "react-bootstrap/Container";
import Nav from "react-bootstrap/Nav";

const mainLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/plans", label: "Plannen" },
  { href: "/shopping", label: "Boodschappen" },
  { href: "/pantry", label: "Voorraad" },
  { href: "/meals", label: "Recepten" },
  { href: "/products", label: "Producten" },
  { href: "/advice", label: "Prijsalerts" },
  { href: "/analytics", label: "Analytics" },
];

const settingsLinks = [
  { href: "/family", label: "Familie" },
  { href: "/settings", label: "Instellingen" },
];

export default function AppNav() {
  const path = usePathname();
  const settingsActive = settingsLinks.some((l) => path === l.href);

  return (
    <Navbar expand="lg" className="navbar-ah navbar-dark shadow-sm">
      <Container>
        <Navbar.Brand as={Link} href="/" className="fw-bold">
          AH Planner
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="main-nav" />
        <Navbar.Collapse id="main-nav">
          <Nav className="me-auto">
            {mainLinks.map((l) => (
              <NavLink
                key={l.href}
                as={Link}
                href={l.href}
                className={`nav-link-ah px-2 py-1 mx-0 ${path === l.href || (l.href !== "/" && path.startsWith(l.href + "/")) ? "active" : ""}`}
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
                <NavDropdown.Item
                  key={l.href}
                  as={Link}
                  href={l.href}
                  active={path === l.href}
                >
                  {l.label}
                </NavDropdown.Item>
              ))}
            </NavDropdown>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}
