'use client';
import { useState } from 'react';
import {
  permissions,
  can,
  type RolePermissions,
  type PermissionOverrides,
  type CustomRole,
} from '@/lib/permissions';
import type { User } from '@/lib/domain';
import { useGarage } from './provider';
import { Button, Field, Form, Modal, value as formValue } from './ui';

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
              <div className="permission-row" data-permission={p.id} key={p.id}>
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
  const [editing, setEditing] = useState<CustomRole | 'new' | null>(null);
  if (editing)
    return (
      <CustomRoleDialog
        role={editing === 'new' ? undefined : editing}
        close={() => setEditing(null)}
      />
    );
  return (
    <Modal
      wide
      title="Permissions des rôles"
      subtitle="Ces réglages s’appliquent aux membres actuels et aux prochaines invitations."
      close={close}
    >
      <section className="settings-card">
        <h3>Rôles personnalisés</h3>
        <p>
          Créez vos rôles puis attribuez-les dans Équipe. Les permissions individuelles restent
          prioritaires.
        </p>
        {(state.settings.customRoles ?? []).map((role) => (
          <div className="pending-invitation" key={role.id}>
            <span>
              <strong>{role.name}</strong>
              <small>
                {state.users.filter((u) => u.customRoleId === role.id).length} membre(s)
              </small>
            </span>
            <Button aria-label={`Modifier ${role.name}`} onClick={() => setEditing(role)}>
              Modifier
            </Button>
          </div>
        ))}
        <Button onClick={() => setEditing('new')}>Créer un rôle</Button>
      </section>
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

export function CustomRoleDialog({ role, close }: { role?: CustomRole; close: () => void }) {
  const { act } = useGarage();
  const [value, setValue] = useState<PermissionOverrides>(role?.permissions ?? {});
  return (
    <Modal wide title={role ? `Modifier ${role.name}` : 'Créer un rôle'} close={close}>
      <Form
        label="Enregistrer le rôle"
        onSubmit={async (f) => {
          await act({
            type: 'customRole',
            ...(role ? { id: role.id } : {}),
            name: formValue(f, 'name'),
            baseRole: formValue(f, 'baseRole') as CustomRole['baseRole'],
            permissions: value,
          });
          close();
        }}
      >
        <Field label="Nom du rôle">
          <input name="name" required maxLength={60} defaultValue={role?.name} />
        </Field>
        <Field
          label="Fonction dans le garage"
          hint="Détermine la présence dans l’atelier 3D. Les accès dépendent uniquement des permissions choisies ci-dessous."
        >
          <select name="baseRole" defaultValue={role?.baseRole ?? 'mechanic'}>
            <option value="mechanic">Mécanicien</option>
            <option value="reception">Accueil</option>
          </select>
        </Field>
        <p className="muted">
          Les permissions non cochées sont interdites. Autorisez aussi la consultation d’une
          catégorie pour permettre ses actions. Seul le patron gère les rôles.
        </p>
        <div className="permissions-editor" data-permission-editor="customRole">
          {groups.map((group) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {permissions
                .filter((p) => p.group === group)
                .map((p) => (
                  <label className="permission-individual" data-permission={p.id} key={p.id}>
                    <span>{p.label}</span>
                    <input
                      type="checkbox"
                      checked={value[p.id] ?? false}
                      onChange={(e) => setValue({ ...value, [p.id]: e.target.checked })}
                    />
                  </label>
                ))}
            </fieldset>
          ))}
        </div>
      </Form>
    </Modal>
  );
}

export function AssignRoleDialog({ member, close }: { member: User; close: () => void }) {
  const { state, act } = useGarage();
  return (
    <Modal
      title={`Rôle de ${member.name}`}
      subtitle="Les exceptions de permissions individuelles sont conservées lors du changement de rôle."
      close={close}
    >
      <Form
        label="Attribuer le rôle"
        onSubmit={async (f) => {
          await act({ type: 'assignRole', userId: member.id, roleId: formValue(f, 'roleId') });
          close();
        }}
      >
        <Field label="Rôle">
          <select name="roleId" defaultValue={member.customRoleId ?? member.role}>
            <option value="mechanic">Mécanicien</option>
            <option value="reception">Accueil</option>
            {state.settings.customRoles?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
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
        <div className="permissions-editor" data-permission-editor="userPermissions">
          {groups.map((group) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {permissions
                .filter((p) => p.group === group)
                .map((p) => (
                  <label className="permission-individual" data-permission={p.id} key={p.id}>
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
