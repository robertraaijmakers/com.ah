"use client";
import { useState } from "react";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Modal from "react-bootstrap/Modal";
import Spinner from "react-bootstrap/Spinner";
import { api, type Product } from "@/lib/api";
import { useToast } from "@/lib/toast";


export function EditGroupModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [groupName, setGroupName] = useState(product.product_group_name ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/products/${product.id}/group`, {
        group_name: groupName.trim() || null,
      });
      showToast("Groep bijgewerkt", "success");
      onSaved();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal show onHide={onClose} size="sm">
      <Modal.Header closeButton>
        <Modal.Title className="h6">Groep aanpassen</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="small text-muted mb-2">{product.name}</p>
        <Form.Label className="small">Groepsnaam</Form.Label>
        <Form.Control
          size="sm"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Leeg = automatisch (wordt overschreven bij scrape)"
        />
        <Form.Text className="text-muted">
          Leeg laten = scraper bepaalt groep opnieuw. Handmatig invullen = blijft vastzetten.
        </Form.Text>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" size="sm" onClick={onClose}>Annuleer</Button>
        <Button className="btn-ah" size="sm" onClick={save} disabled={saving}>
          {saving && <Spinner size="sm" className="me-1" />}Opslaan
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

