"use client";
import Badge from "react-bootstrap/Badge";
import { type FamilyMember } from "@/lib/api";
import { TYPE_COLOR } from "@/lib/plans";


export function MemberChip({
  member,
  active,
  onClick,
}: {
  member: FamilyMember;
  active: boolean;
  onClick: () => void;
}) {
  const color = TYPE_COLOR[member.member_type];
  return (
    <Badge
      bg={active ? color : "light"}
      text={active ? "white" : "muted"}
      className="border fw-normal"
      style={{ fontSize: "0.65rem", cursor: "pointer", userSelect: "none" }}
      onClick={onClick}
      title={member.member_type === "generic_guest" ? "Anonieme gast" : member.member_type === "regular_guest" ? "Vaste gast" : ""}
    >
      {member.name}
    </Badge>
  );
}

