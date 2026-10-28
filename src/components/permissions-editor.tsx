'use client';
import { useState } from 'react';
import {
  permissions,
  can,
  type RolePermissions,
  type PermissionOverrides,
} from '@/lib/permissions';
import type { User } from '@/lib/domain';
import { useGarage } from './provider';
import { Form, Modal } from './ui';

const roles = [
  { id: 'mechanic', label: 'Mécanicien' },
  { id: 'reception', label: 'Accueil' },
] as const;
const groups = [...new Set(permissions.map((p) => p.group))];

export function RolePermissionsEditor({
  value,
  onChange,
}: {
  value: RolePermissions;
  onChange: (value: RolePermissions) => void;
}) {
  return (
    <div className="permissions-editor">
      <p className="muted">
        Le patron conserve l’accès complet. Les exceptions individuelles définies dans Équipe
        restent prioritaires.
      </p>
      <p className="muted">
        Autorisez aussi la consultation d’une catégorie pour permettre les actions associées.
      </p>
      {groups.map((group) => (
        <fieldset key={group}>
          <legend>{group}</legend>
          <div className="permission-row permission-head">
            <span>Permission</span>
            {roles.map((role) => (
              <span key={role.id}>{role.label}</span>
            ))}
          </div>
          {permissions
            .filter((p) => p.group === group)
            .map((p) => (
              <div className="permission-row" key={p.id}>
                <span>{p.label}</span>
                {roles.map((role) => (
                  <input
                    key={role.id}
                    type="checkbox"
                    aria-label={`${p.label} — ${role.label}`}
                    checked={value[role.id]?.[p.id] ?? p[role.id]}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        [role.id]: { ...value[role.id], [p.id]: e.target.checked },
                      })
                    }
                  />
                ))}
              </div>
            ))}
        </fieldset>
      ))}
      <button type="button" className="text-button" onClick={() => onChange({})}>
        Rétablir les permissions par défaut
      </button>
    </div>
  );
}

export function RolePermissionsDialog({ close }: { close: () => void }) {
  const { state, act } = useGarage();
  const [value, setValue] = useState<RolePermissions>(state.settings.rolePermissions ?? {});
  return (
    <Modal
      wide
      title="Permissions des rôles"
      subtitle="Ces réglages s’appliquent aux membres actuels et aux prochaines invitations."
      close={close}
    >
      <Form
        label="Enregistrer les permissions"
        onSubmit={async () => {
          await act({ type: 'rolePermissions', permissions: value });
          close();
        }}
      >
        <RolePermissionsEditor value={value} onChange={setValue} />
      </Form>
    </Modal>
  );
}

export function UserPermissionsDialog({ member, close }: { member: User; close: () => void }) {
  const { state, act } = useGarage();
  const [value, setValue] = useState<PermissionOverrides>(member.permissions ?? {});
  return (
    <Modal
      wide
      title={`Permissions de ${member.name}`}
      subtitle="Une autorisation ou une interdiction individuelle remplace le réglage du rôle, y compris après sa modification."
      close={close}
    >
      <Form
        label="Enregistrer les permissions"
        onSubmit={async () => {
          await act({ type: 'userPermissions', userId: member.id, permissions: value });
          close();
        }}
      >
        <div className="permissions-editor">
          {groups.map((group) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {permissions
                .filter((p) => p.group === group)
                .map((p) => (
                  <label className="permission-individual" key={p.id}>
                    <span>{p.label}</span>
                    <select
                      aria-label={p.label}
                      value={value[p.id] === undefined ? 'inherit' : value[p.id] ? 'allow' : 'deny'}
                      onChange={(e) => {
                        const next = { ...value };
                        if (e.target.value === 'inherit') delete next[p.id];
                        else next[p.id] = e.target.value === 'allow';
                        setValue(next);
                      }}
                    >
                      <option value="inherit">
                        Hériter du rôle (
                        {can(state, { ...member, permissions: undefined }, p.id)
                          ? 'autorisé'
                          : 'interdit'}
                        )
                      </option>
                      <option value="allow">Autoriser</option>
                      <option value="deny">Interdire</option>
                    </select>
                  </label>
                ))}
            </fieldset>
          ))}
          <button type="button" className="text-button" onClick={() => setValue({})}>
            Tout rétablir selon le rôle
          </button>
        </div>
      </Form>
    </Modal>
  );
}
