'use client';
import { useCallback, useState } from 'react';
import {
  Layers3,
  LayoutDashboard,
  ListChecks,
  Users,
  CarFront,
  CalendarDays,
  FileText,
  Receipt,
  Package,
  Settings2,
  ChevronDown,
  Search,
  Plus,
  Bell,
  LogOut,
  Menu,
  Radio,
  Check,
  Compass,
} from 'lucide-react';
import { useGarage } from './provider';
import { TrainingTour } from './training-tour';
import { Avatar, Button } from './ui';
import { Configure, VehicleForm } from './forms';
import { VehicleDrawer } from './vehicle-drawer';
import { TasksScreen } from './tasks';
import { DocumentsScreen } from './documents';
import {
  CustomersScreen,
  InventoryScreen,
  MessagesScreen,
  PlanningScreen,
  SettingsScreen,
  TeamScreen,
  VehiclesScreen,
} from './management';
import { Dashboard } from './dashboard';
import { GarageSwitcher } from './garage-switcher';
import type { Permission } from '@/lib/permissions';
import { roleLabel } from '@/lib/permissions';
import { OnboardingTour } from './onboarding-tour';
import { AccountScreen } from './account-screen';
import { AccountNotifications } from './account-notifications';
import { BillingNotice } from './billing';
const pagePermissions: Record<string, Permission> = {
  garage: 'garage.view',
  tasks: 'garage.view',
  vehicles: 'garage.view',
  customers: 'customers.view',
  planning: 'planning.view',
  estimates: 'documents.view',
  invoices: 'documents.view',
  inventory: 'stock.view',
  messages: 'mail.send',
};
const navigation = [
  { id: 'garage', title: 'Mon garage', icon: LayoutDashboard },
  { id: 'tasks', title: 'Mon travail', icon: ListChecks },
  { id: 'planning', title: 'Planning', icon: CalendarDays },
  { id: 'vehicles', title: 'Véhicules', icon: CarFront },
  { id: 'customers', title: 'Clients', icon: Users },
  { id: 'estimates', title: 'Devis', icon: FileText },
  { id: 'invoices', title: 'Factures', icon: Receipt },
  { id: 'inventory', title: 'Pièces & stock', icon: Package },
  { id: 'team', title: 'Équipe', icon: Users },
];

export function AppShell({ initialPage }: { initialPage?: string }) {
  const { state, user, account, connected, refresh, notify, can, request, training } = useGarage();
  const pageAllowed = (id: string) => !pagePermissions[id] || can(pagePermissions[id]);
  const [requestedPage, setPage] = useState(
    initialPage ??
      account?.preferences?.initialPage ??
      (user.role === 'mechanic' ? 'tasks' : 'garage'),
  );
  const page = pageAllowed(requestedPage) ? requestedPage : 'team';
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [configure, setConfigure] = useState(!state.settings.configured && can('garage.configure'));
  const [menu, setMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const [switchGarage, setSwitchGarage] = useState(false);
  const [tourLaunch, setTourLaunch] = useState(0);
  const [trainingPage, setTrainingPage] = useState<string>();
  const draftCount = state.mails.filter(
    (m) => m.status === 'draft' || m.status === 'failed',
  ).length;
  const mine = state.vehicles
    .flatMap((v) => v.tasks)
    .filter((t) => t.assignees.includes(user.id) && t.status !== 'done').length;
  const navigate = useCallback((id: string) => {
    setPage(id);
    setMenu(false);
    setSearch('');
  }, []);
  const title =
    navigation.find((n) => n.id === page)?.title ??
    (page === 'messages' ? 'Messages' : page === 'account' ? 'Mon compte' : 'Paramètres du garage');
  return (
    <div
      className="app-shell"
      data-reduced-motion={account?.preferences?.reducedMotion || undefined}
    >
      {menu && (
        <button
          className="mobile-scrim"
          aria-label="Fermer le menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('garage');
          }}
        >
          <span className="brand-mark">
            <Layers3 size={25} />
          </span>
          Caragem<span className="brand-dot">.</span>
          <span className="brand-beta">BETA</span>
        </a>
        <button className="garage-switch" onClick={() => setSwitchGarage(true)}>
          <span className="garage-avatar">G</span>
          <span>
            <strong>{state.settings.name}</strong>
            <small>{state.demo ? 'Espace de démonstration' : 'Votre espace de travail'}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-label">ESPACE DE TRAVAIL</span>
        <nav>
          {navigation
            .filter((n) => pageAllowed(n.id))
            .map((n, i) => (
              <div key={n.id}>
                {i === 5 && <div className="nav-divider" />}
                <button
                  data-tour-nav={n.id}
                  className={`nav-item ${page === n.id ? 'active' : ''}`}
                  onClick={() => navigate(n.id)}
                >
                  <n.icon size={18} strokeWidth={1.7} />
                  {n.title}
                  {n.id === 'tasks' && mine > 0 && <span className="nav-count">{mine}</span>}
                  {n.id === 'garage' && <span className="nav-active-dot" />}
                </button>
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          {!training && (
            <button
              className="nav-item"
              onClick={() => {
                setMenu(false);
                setProfile(false);
                setTourLaunch((n) => n + 1);
              }}
            >
              <Compass size={18} />
              Visite guidée
            </button>
          )}
          {can('mail.send') && (
            <button
              data-tour-nav="messages"
              className={`nav-item ${page === 'messages' ? 'active' : ''}`}
              onClick={() => navigate('messages')}
            >
              <Bell size={18} />
              Messages
              {draftCount > 0 && <span className="nav-count">{draftCount}</span>}
            </button>
          )}
          <button
            data-tour-nav="settings"
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            Paramètres
          </button>
          <div className="connection-card">
            <span className={`live-dot ${connected ? '' : 'offline'}`} />
            <div>
              <strong>{connected ? 'Votre équipe est connectée' : 'Connexion en cours…'}</strong>
              <small>{connected ? 'Mises à jour en temps réel' : 'Reconnexion automatique'}</small>
            </div>
            <Radio size={16} />
          </div>
          <div className="sidebar-user">
            <Avatar avatar={user.avatar} name={user.name} color={user.color} />
            <div>
              <strong>{user.name}</strong>
              <small>{roleLabel(state, user)}</small>
            </div>
            <button
              className="icon-button"
              disabled={training}
              title="Se déconnecter"
              aria-label="Se déconnecter"
              onClick={async () => {
                try {
                  await request('logout', {});
                  await refresh();
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Ouvrir le menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span>Espace de travail</span>
            <ChevronDown size={13} className="breadcrumb-chevron" />
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`live-status ${connected ? '' : 'muted'}`}>
              <i className={connected ? '' : 'offline'} />
              {connected ? 'En direct' : 'Hors connexion'}
            </span>
            {account && !training ? (
              <AccountNotifications
                onNavigate={(destination, vehicleId) => {
                  navigate(destination);
                  if (vehicleId) setSelected(vehicleId);
                }}
              />
            ) : (
              <button
                className="notification-button icon-button"
                aria-label={`${draftCount} messages à valider`}
                onClick={() => navigate('messages')}
              >
                <Bell size={19} />
                {draftCount > 0 && <i />}
              </button>
            )}
            <button
              className="profile-button"
              disabled={training}
              title={state.demo ? 'Changer de profil de démonstration' : 'Mon compte'}
              aria-label="Options du profil"
              onClick={() => setProfile(!profile)}
            >
              <Avatar avatar={user.avatar} name={user.name} color={user.color} small />
              <ChevronDown size={13} />
            </button>
          </div>
          {profile && (
            <div className="profile-menu">
              <strong>{state.demo ? 'Tester un autre rôle' : user.name}</strong>
              {state.demo &&
                state.users.map((u) => (
                  <button
                    key={u.id}
                    onClick={async () => {
                      await request('demo-user', { userId: u.id });
                      await refresh();
                    }}
                  >
                    <Avatar avatar={u.avatar} name={u.name} color={u.color} small />
                    <span>
                      {u.name}
                      <small>{roleLabel(state, u)}</small>
                    </span>
                    {u.id === user.id && <Check size={15} />}
                  </button>
                ))}
              <button
                onClick={() => {
                  setProfile(false);
                  navigate('account');
                }}
              >
                <Settings2 size={16} />
                Mon compte
              </button>
            </div>
          )}
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                {new Date().toLocaleDateString('fr-FR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
                {state.demo && <span>GARAGE DÉMO</span>}
              </div>
              <div className="garage-heading-title">
                <h1>{page === 'garage' ? 'Votre garage, en un coup d’œil.' : title}</h1>
                <BillingNotice visible={page === 'garage'} />
              </div>
              {page === 'garage' && (
                <p>Chaque voiture à sa place. Toute l’équipe dans le même élan.</p>
              )}
            </div>
            <div className="page-heading-actions">
              {['garage', 'vehicles', 'customers'].includes(page) && (
                <label className="global-search">
                  <Search size={17} />
                  <input
                    aria-label="Rechercher un véhicule ou un client"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Véhicule, immatriculation, client…"
                  />
                  <kbd>⌕</kbd>
                </label>
              )}
              {page === 'garage' && can('vehicles.create') && (
                <Button className="primary" data-tour="arrival" onClick={() => setCreate(true)}>
                  <Plus size={17} />
                  Nouvelle arrivée
                </Button>
              )}
            </div>
          </div>
          <div data-tour="content">
            {page === 'garage' && (
              <Dashboard
                search={search}
                selected={selected}
                selectVehicle={setSelected}
                configure={() => setConfigure(true)}
                navigate={navigate}
              />
            )}
            {page === 'tasks' && <TasksScreen selectVehicle={setSelected} />}
            {page === 'customers' && (
              <CustomersScreen selectVehicle={setSelected} search={search} />
            )}
            {page === 'vehicles' && <VehiclesScreen selectVehicle={setSelected} search={search} />}
            {page === 'planning' && <PlanningScreen selectVehicle={setSelected} />}
            {page === 'estimates' && (
              <DocumentsScreen kind="estimate" selectVehicle={setSelected} />
            )}
            {page === 'invoices' && <DocumentsScreen kind="invoice" selectVehicle={setSelected} />}
            {page === 'inventory' && <InventoryScreen />}
            {page === 'team' && <TeamScreen />}
            {page === 'messages' && <MessagesScreen />}
            {page === 'settings' && <SettingsScreen />}
            {page === 'account' && <AccountScreen />}
          </div>
          <footer className="workspace-footer">
            <span>Caragem · Le garage, en mouvement.</span>
            <span>
              <span className="live-dot" />
              {state.demo ? 'Données de démonstration' : 'Données enregistrées dans votre garage'}
            </span>
          </footer>
          {!training &&
            ['garage', 'customers', 'estimates', 'inventory', 'messages', 'team'].includes(
              page,
            ) && (
              <Button
                className="page-tour-launch"
                data-tour="page-help"
                aria-label={`Visite guidée de ${title}`}
                onClick={() => {
                  setMenu(false);
                  setProfile(false);
                  setTrainingPage(page);
                }}
              >
                <Compass size={17} /> Visite guidée
              </Button>
            )}
        </main>
      </div>
      {switchGarage && <GarageSwitcher close={() => setSwitchGarage(false)} />}
      {selected && can('garage.view') && state.vehicles.some((v) => v.id === selected) && (
        <VehicleDrawer key={selected} id={selected} close={() => setSelected(null)} />
      )}
      {create && can('vehicles.create') && <VehicleForm close={() => setCreate(false)} />}
      {configure && can('garage.configure') && <Configure close={() => setConfigure(false)} />}
      <OnboardingTour
        enabled={
          !training &&
          !configure &&
          !create &&
          !selected &&
          !switchGarage &&
          !profile &&
          !trainingPage
        }
        launch={tourLaunch}
        page={page}
        navigate={navigate}
        menuOpen={menu}
        showMenu={setMenu}
      />
      {trainingPage && (
        <TrainingTour page={trainingPage} close={() => setTrainingPage(undefined)} />
      )}
    </div>
  );
}
