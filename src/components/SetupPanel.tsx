import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadSetup, saveLocation, saveLocationType, saveUserType, setLocationStatus, type SetupData } from '../lib/data';
import { FEATURE_GROUPS, allowedFeatures, defaultFeatures, type Feature } from '../lib/features';
import type { Environment, Location, LocationType, Profile, SetupLocation, UserType } from '../lib/types';
import { LayoutEditor } from './LayoutEditor';
import { ROLE_ORDER, roleDetails, type Role } from '../roles';

const LEVELS: Record<number, { label: string; icon: string }> = {
  1: { label: 'Campus', icon: '🏫' },
  2: { label: 'Building or grounds', icon: '🏢' },
  3: { label: 'Floor or wing', icon: '🧱' },
  4: { label: 'Room or area', icon: '🚪' },
};

type Section = 'locations' | 'layout' | 'types' | 'userTypes';

export function SetupPanel({ profile, features, people, onPeopleChanged }: { profile: Profile; features: Set<Feature>; people: Profile[]; onPeopleChanged: () => Promise<void> }) {
  const sections: { key: Section; label: string }[] = [
    ...(features.has('setup.locations') ? [{ key: 'locations' as const, label: 'Locations' }, { key: 'layout' as const, label: 'Map layout' }, { key: 'types' as const, label: 'Location types' }] : []),
    ...(features.has('setup.user_types') ? [{ key: 'userTypes' as const, label: 'User types' }] : []),
  ];
  const [section, setSection] = useState<Section>(sections[0]?.key ?? 'locations');
  const [data, setData] = useState<SetupData>({ locations: [], types: [], userTypes: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const reload = useCallback(async () => {
    const r = await loadSetup();
    setData(r.data);
    setLoadError(r.error ?? '');
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function patchLocation(id: string, patch: Partial<Location>) {
    setData((d) => ({ ...d, locations: d.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }

  return (
    <div className="setup">
      <div className="filter-row" role="tablist" aria-label="Setup sections">
        {sections.map((s) => (
          <button type="button" role="tab" key={s.key} aria-selected={section === s.key} className={`filter-button${section === s.key ? ' is-active' : ''}`} onClick={() => setSection(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {loadError && <p className="error-text">{loadError}</p>}
      {loading ? (
        <p className="empty-note">Loading setup…</p>
      ) : (
        <>
          {section === 'locations' && <LocationsSetup profile={profile} data={data} onChanged={reload} />}
          {section === 'layout' && <LayoutEditor locations={data.locations} onPatch={patchLocation} />}
          {section === 'types' && <LocationTypesSetup profile={profile} data={data} onChanged={reload} />}
          {section === 'userTypes' && (
            <UserTypesSetup
              profile={profile}
              userTypes={data.userTypes}
              people={people}
              onChanged={async () => {
                await reload();
                await onPeopleChanged();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// --- Locations ---------------------------------------------------------------

type Editor = { mode: 'add'; parent: SetupLocation | null } | { mode: 'edit'; location: SetupLocation };

function LocationsSetup({ profile, data, onChanged }: { profile: Profile; data: SetupData; onChanged: () => Promise<void> }) {
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const typeById = useMemo(() => new Map(data.types.map((t) => [t.id, t])), [data.types]);
  const levelOf = (l: SetupLocation) => typeById.get(l.category_id)?.level ?? 4;
  const visible = data.locations.filter((l) => showArchived || l.status !== 'archived');
  const visibleIds = new Set(visible.map((l) => l.id));
  const children = new Map<string | null, SetupLocation[]>();
  for (const l of visible) {
    const key = l.parent_id && visibleIds.has(l.parent_id) ? l.parent_id : null;
    children.set(key, [...(children.get(key) ?? []), l]);
  }
  const sortNodes = (list: SetupLocation[]) => [...list].sort((a, b) => levelOf(a) - levelOf(b) || a.name.localeCompare(b.name));
  const activeChildren = (id: string) => data.locations.some((l) => l.parent_id === id && l.status !== 'archived');
  const maxLevel = Math.max(0, ...data.types.filter((t) => t.is_active).map((t) => t.level));

  async function changeStatus(l: SetupLocation, status: 'active' | 'archived') {
    setBusy(l.id);
    setError('');
    const r = await setLocationStatus(l.id, status);
    if (r.error) setError(r.error);
    else await onChanged();
    setBusy(null);
  }

  function renderNode(l: SetupLocation, depth: number) {
    const type = typeById.get(l.category_id);
    const level = type?.level ?? 4;
    const kids = sortNodes(children.get(l.id) ?? []);
    const isCollapsed = collapsed.has(l.id);
    const archived = l.status === 'archived';
    return (
      <li key={l.id}>
        <div className={`tree-row${archived ? ' is-archived' : ''}`} style={{ paddingLeft: 10 + depth * 18 }}>
          {kids.length > 0 ? (
            <button
              type="button"
              className="tree-toggle"
              aria-label={isCollapsed ? `Expand ${l.name}` : `Collapse ${l.name}`}
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((s) => {
                const next = new Set(s);
                if (next.has(l.id)) next.delete(l.id);
                else next.add(l.id);
                return next;
              })}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="tree-toggle" aria-hidden="true" />
          )}
          <span className="tree-icon" aria-hidden="true">{l.environment === 'outdoor' ? '🌳' : LEVELS[level].icon}</span>
          <span className="tree-name">
            <strong>{l.name}</strong>
            <small>
              {type?.name ?? 'Unknown type'}
              {l.code ? ` · ${l.code}` : ''} · {l.environment}
              {archived ? ' · archived' : ''}
            </small>
          </span>
          <span className="tree-actions">
            {!archived && level < maxLevel && (
              <button type="button" className="action-small" onClick={() => setEditor({ mode: 'add', parent: l })}>
                + Inside
              </button>
            )}
            {!archived && (
              <button type="button" className="action-small" onClick={() => setEditor({ mode: 'edit', location: l })}>
                Edit
              </button>
            )}
            {!archived ? (
              <button type="button" className="action-small" disabled={busy === l.id || activeChildren(l.id)} title={activeChildren(l.id) ? 'Archive or move the places inside first' : undefined} onClick={() => changeStatus(l, 'archived')}>
                Archive
              </button>
            ) : (
              <button type="button" className="action-small" disabled={busy === l.id} onClick={() => changeStatus(l, 'active')}>
                Restore
              </button>
            )}
          </span>
        </div>
        {editor?.mode === 'add' && editor.parent?.id === l.id && (
          <LocationForm profile={profile} types={data.types} parent={l} parentLevel={level} onDone={async (saved) => { setEditor(null); if (saved) await onChanged(); }} />
        )}
        {editor?.mode === 'edit' && editor.location.id === l.id && (
          <LocationForm
            profile={profile}
            types={data.types}
            parent={data.locations.find((p) => p.id === l.parent_id) ?? null}
            parentLevel={l.parent_id ? typeById.get(data.locations.find((p) => p.id === l.parent_id)?.category_id ?? '')?.level ?? 0 : 0}
            location={l}
            onDone={async (saved) => { setEditor(null); if (saved) await onChanged(); }}
          />
        )}
        {kids.length > 0 && !isCollapsed && <ul className="tree">{kids.map((k) => renderNode(k, depth + 1))}</ul>}
      </li>
    );
  }

  const roots = sortNodes(children.get(null) ?? []);
  const activeCount = data.locations.filter((l) => l.status !== 'archived').length;

  return (
    <section>
      <div className="setup-head">
        <div>
          <h2 className="section-title">Campus and places</h2>
          <p className="empty-note">
            {activeCount} active places. Places show up as location buttons when people report.
          </p>
        </div>
        <button type="button" className="action-small primary" onClick={() => setEditor({ mode: 'add', parent: null })}>
          + Add campus
        </button>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived places
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {editor?.mode === 'add' && editor.parent === null && (
        <LocationForm profile={profile} types={data.types} parent={null} parentLevel={0} onDone={async (saved) => { setEditor(null); if (saved) await onChanged(); }} />
      )}
      {roots.length === 0 ? <p className="empty-note">No places yet. Start by adding a campus.</p> : <ul className="tree tree-root">{roots.map((r) => renderNode(r, 0))}</ul>}
    </section>
  );
}

function LocationForm({ profile, types, parent, parentLevel, location, onDone }: { profile: Profile; types: LocationType[]; parent: SetupLocation | null; parentLevel: number; location?: SetupLocation; onDone: (saved: boolean) => void }) {
  const choices = types.filter((t) => (t.is_active || t.id === location?.category_id) && (parent ? t.level > parentLevel : t.level === 1));
  const [name, setName] = useState(location?.name ?? '');
  const [code, setCode] = useState(location?.code ?? '');
  const [typeId, setTypeId] = useState(choices.find((t) => t.id === location?.category_id)?.id ?? choices[0]?.id ?? '');
  const type = types.find((t) => t.id === typeId);
  const [environment, setEnvironment] = useState<Environment>(location?.environment ?? (type?.environment === 'outdoor' ? 'outdoor' : 'indoor'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const envOptions: Environment[] = type?.environment === 'indoor' ? ['indoor'] : type?.environment === 'outdoor' ? ['outdoor'] : ['indoor', 'outdoor', 'covered'];
  const env = envOptions.includes(environment) ? environment : envOptions[0];

  async function save() {
    setSaving(true);
    setError('');
    const r = await saveLocation(profile, { id: location?.id, name, parentId: parent?.id ?? null, categoryId: typeId, environment: env, code: code || null });
    setSaving(false);
    if (r.error) setError(r.error);
    else onDone(true);
  }

  if (!choices.length) {
    return (
      <div className="setup-form">
        <p className="empty-note">No location type fits here. Add one in Location types with a level below {LEVELS[parentLevel]?.label ?? 'the parent'}.</p>
        <button type="button" className="action-small" onClick={() => onDone(false)}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="setup-form">
      <p className="setup-form-title">{location ? `Edit ${location.name}` : parent ? `Add a place inside ${parent.name}` : 'Add a campus'}</p>
      <div className="form-grid">
        <label className="field">
          Name
          <input value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Science Building, Room 204, Girls' CR" />
        </label>
        <label className="field">
          Type
          <select className="role-select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {[1, 2, 3, 4].map((lvl) => {
              const group = choices.filter((t) => t.level === lvl);
              return group.length ? (
                <optgroup key={lvl} label={LEVELS[lvl].label}>
                  {group.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label className="field">
          Code (optional)
          <input value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SCI-204" />
        </label>
      </div>
      <div className="chip-row" role="group" aria-label="Environment">
        {envOptions.map((e) => (
          <button type="button" key={e} className={`filter-button${env === e ? ' is-active' : ''}`} aria-pressed={env === e} onClick={() => setEnvironment(e)}>
            {e}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="chip-row">
        <button type="button" className="action-small primary" disabled={saving || name.trim().length < 2 || !typeId} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="action-small" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Location types ----------------------------------------------------------

function LocationTypesSetup({ profile, data, onChanged }: { profile: Profile; data: SetupData; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<LocationType | 'new' | null>(null);
  const usage = (id: string) => data.locations.filter((l) => l.category_id === id && l.status !== 'archived').length;

  return (
    <section>
      <div className="setup-head">
        <div>
          <h2 className="section-title">Location types</h2>
          <p className="empty-note">The level decides what can go inside what: a campus holds buildings and grounds, buildings hold floors, floors hold rooms and areas.</p>
        </div>
        <button type="button" className="action-small primary" onClick={() => setEditing('new')}>
          + Add type
        </button>
      </div>
      {editing === 'new' && <LocationTypeForm profile={profile} onDone={async (saved) => { setEditing(null); if (saved) await onChanged(); }} />}
      {[1, 2, 3, 4].map((lvl) => {
        const group = data.types.filter((t) => t.level === lvl);
        return (
          <div key={lvl} className="type-group">
            <h3>
              <span aria-hidden="true">{LEVELS[lvl].icon}</span> Level {lvl} · {LEVELS[lvl].label}
            </h3>
            {group.length === 0 ? (
              <p className="empty-note">No types at this level.</p>
            ) : (
              <ul className="queue-list">
                {group.map((t) => (
                  <li key={t.id} className={`queue-item${t.is_active ? '' : ' is-archived'}`}>
                    <div className="queue-main">
                      <strong>{t.name}</strong>
                      <small>
                        {t.environment} · {usage(t.id)} place{usage(t.id) === 1 ? '' : 's'}
                        {t.is_active ? '' : ' · turned off'}
                      </small>
                    </div>
                    <div className="queue-actions">
                      <button type="button" className="action-small" onClick={() => setEditing(t)}>
                        Edit
                      </button>
                    </div>
                    {editing !== 'new' && editing?.id === t.id && (
                      <LocationTypeForm profile={profile} type={t} inUse={usage(t.id) > 0} onDone={async (saved) => { setEditing(null); if (saved) await onChanged(); }} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

function LocationTypeForm({ profile, type, inUse = false, onDone }: { profile: Profile; type?: LocationType; inUse?: boolean; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(type?.name ?? '');
  const [level, setLevel] = useState<number>(type?.level ?? 4);
  const [environment, setEnvironment] = useState<string>(type?.environment ?? 'indoor');
  const [active, setActive] = useState(type?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    const r = await saveLocationType(profile, { id: type?.id, name, level, environment, isActive: active });
    setSaving(false);
    if (r.error) setError(r.error);
    else onDone(true);
  }

  return (
    <div className="setup-form">
      <p className="setup-form-title">{type ? `Edit ${type.name}` : 'New location type'}</p>
      <div className="form-grid">
        <label className="field">
          Name
          <input value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. CR (Comfort Room)" />
        </label>
        <label className="field">
          Level
          <select className="role-select" value={level} disabled={inUse} onChange={(e) => setLevel(Number(e.target.value))}>
            {[1, 2, 3, 4].map((l) => (
              <option key={l} value={l}>
                {l} · {LEVELS[l].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Environment
          <select className="role-select" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="indoor">Indoor</option>
            <option value="outdoor">Outdoor</option>
            <option value="either">Either</option>
          </select>
        </label>
      </div>
      {inUse && <p className="fine-print">The level is locked because places use this type.</p>}
      <label className="check-row">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Available for new places
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="chip-row">
        <button type="button" className="action-small primary" disabled={saving || name.trim().length < 2} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="action-small" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- User types --------------------------------------------------------------

function UserTypesSetup({ profile, userTypes, people, onChanged }: { profile: Profile; userTypes: UserType[]; people: Profile[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<UserType | 'new' | null>(null);
  const countFor = (id: string) => people.filter((p) => p.user_type_id === id).length;
  const sorted = [...userTypes].sort((a, b) => Number(b.is_system) - Number(a.is_system) || ROLE_ORDER.indexOf(a.base_role) - ROLE_ORDER.indexOf(b.base_role) || a.name.localeCompare(b.name));

  return (
    <section>
      <div className="setup-head">
        <div>
          <h2 className="section-title">User types</h2>
          <p className="empty-note">Each user type is built on a base role. The base role decides what data the person can reach; the features decide which menus and report buttons they see.</p>
        </div>
        <button type="button" className="action-small primary" onClick={() => setEditing('new')}>
          + New user type
        </button>
      </div>
      {editing === 'new' && <UserTypeForm profile={profile} assigned={0} onDone={async (saved) => { setEditing(null); if (saved) await onChanged(); }} />}
      <ul className="queue-list">
        {sorted.map((t) => (
          <li key={t.id} className={`queue-item${t.is_active ? '' : ' is-archived'}`}>
            <span className="queue-icon" aria-hidden="true">{roleDetails[t.base_role].icon}</span>
            <div className="queue-main">
              <strong>
                {t.name}
                {t.is_system && <span className="chip chip-inline">built-in</span>}
                {!t.is_active && <span className="chip chip-inline">off</span>}
              </strong>
              <small>
                Base role: {roleDetails[t.base_role].label} · {countFor(t.id)} {countFor(t.id) === 1 ? 'person' : 'people'} · {t.features.length} features
              </small>
              {t.description && <small>{t.description}</small>}
            </div>
            <div className="queue-actions">
              <button type="button" className="action-small" onClick={() => setEditing(t)}>
                Edit
              </button>
            </div>
            {editing !== 'new' && editing?.id === t.id && (
              <UserTypeForm profile={profile} type={t} assigned={countFor(t.id)} onDone={async (saved) => { setEditing(null); if (saved) await onChanged(); }} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function UserTypeForm({ profile, type, assigned, onDone }: { profile: Profile; type?: UserType; assigned: number; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(type?.name ?? '');
  const [description, setDescription] = useState(type?.description ?? '');
  const [baseRole, setBaseRole] = useState<Role>(type?.base_role ?? 'student');
  const [chosen, setChosen] = useState<Set<string>>(new Set(type?.features ?? defaultFeatures('student')));
  const [active, setActive] = useState(type?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const allowed = new Set<string>(allowedFeatures(baseRole));
  const roleLocked = Boolean(type?.is_system) || assigned > 0;

  function changeRole(role: Role) {
    setBaseRole(role);
    const ceiling = new Set<string>(allowedFeatures(role));
    setChosen(type ? new Set([...chosen].filter((f) => ceiling.has(f))) : new Set(defaultFeatures(role)));
  }

  function toggle(f: string) {
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError('');
    const r = await saveUserType(profile, { id: type?.id, name, description, baseRole, features: [...chosen].filter((f) => allowed.has(f)), isActive: active });
    setSaving(false);
    if (r.error) setError(r.error);
    else onDone(true);
  }

  return (
    <div className="setup-form">
      <p className="setup-form-title">{type ? `Edit ${type.name}` : 'New user type'}</p>
      <div className="form-grid">
        <label className="field">
          Name
          <input value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Canteen Staff, School Nurse" />
        </label>
        <label className="field">
          Base role
          <select className="role-select" value={baseRole} disabled={roleLocked} onChange={(e) => changeRole(e.target.value as Role)}>
            {ROLE_ORDER.map((r) => (
              <option key={r} value={r}>
                {roleDetails[r].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {roleLocked && <p className="fine-print">{type?.is_system ? 'Built-in types keep their base role.' : `The base role is locked while ${assigned} ${assigned === 1 ? 'person has' : 'people have'} this type.`}</p>}
      <label className="field">
        Description (optional)
        <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="Who this type is for" />
      </label>
      {FEATURE_GROUPS.map((group) => (
        <fieldset key={group.title} className="feature-group">
          <legend>{group.title}</legend>
          {group.features.map((f) => {
            const ok = allowed.has(f.key);
            return (
              <label key={f.key} className={`feature-check${ok ? '' : ' is-disabled'}`}>
                <input type="checkbox" disabled={!ok} checked={ok && chosen.has(f.key)} onChange={() => toggle(f.key)} />
                <span>
                  <strong>{f.label}</strong>
                  <small>{ok ? f.hint : `Not available for ${roleDetails[baseRole].label}`}</small>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
      {!type?.is_system && (
        <label className="check-row">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Can be assigned to people
        </label>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="chip-row">
        <button type="button" className="action-small primary" disabled={saving || name.trim().length < 2} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="action-small" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
