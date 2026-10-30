'use client';
import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import {
  csvDatasets,
  suggestMapping,
  transferExamples,
  type TransferKind,
  type ImportReport,
} from '@/lib/data-transfer';
import { parseCsv, csvMaxBytes } from '@/lib/csv';
import { useGarage } from './provider';
import { Button, Field, Modal } from './ui';

export function CsvTransfer({ close }: { close: () => void }) {
  const { user, request, api, notify, training } = useGarage();
  const [kind, setKind] = useState<TransferKind>('customers');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseCsv> | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<(ImportReport & { revision: number }) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<'csv' | 'xls' | 'xlsx'>('csv');
  const [sheetInfo, setSheetInfo] = useState('');
  const [sourceRows, setSourceRows] = useState<Record<number, number>>({});
  if (user.role !== 'owner' || training) return null;
  const dataset = csvDatasets[kind];
  async function download(template = false, example = false) {
    setBusy(true);
    setError('');
    try {
      const result = await request<{
        filename: string;
        csv?: string;
        base64?: string;
        mime?: string;
      }>('data-transfer/export', {
        kind,
        template,
        example,
        format,
      });
      // A running server may still use the CSV-only API during a frontend update.
      if (format !== 'csv' && result.csv !== undefined) {
        const { writeSpreadsheet } = await import('@/lib/spreadsheet-export');
        result.base64 = writeSpreadsheet(result.csv, format);
        result.filename = result.filename.replace(/\.csv$/i, '') + '.' + format;
        result.mime =
          format === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/vnd.ms-excel';
      }
      const bytes = result.base64
        ? Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0))
        : result.csv!;
      const url = URL.createObjectURL(
        new Blob([bytes], { type: result.mime ?? 'text/csv;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      setPreview(
        await request<ImportReport & { revision: number }>('data-transfer/preview', {
          kind,
          csv: content,
          mapping,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview || preview.errors.length || !preview.added) return;
    setBusy(true);
    setError('');
    try {
      await api('data-transfer/import', {
        kind,
        csv: content,
        mapping,
        revision: preview.revision,
      });
      notify(
        `${preview.added} enregistrement(s) importé(s), ${preview.skipped} doublon(s) ignoré(s).`,
      );
      setParsed(null);
      setContent('');
      setFilename('');
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title="Importer / exporter les données"
      subtitle="Transférez vos données entre CaRM et vos autres outils."
      close={close}
    >
      <div className="form">
        <Field label="Données à transférer">
          <select
            value={kind}
            disabled={busy}
            onChange={(e) => {
              setKind(e.target.value as TransferKind);
              setParsed(null);
              setContent('');
              setFilename('');
              setPreview(null);
              setError('');
              setSheetInfo('');
              setSourceRows({});
            }}
          >
            {Object.entries(csvDatasets).map(([key, data]) => (
              <option key={key} value={key}>
                {data.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="muted small-text">{dataset.help}</p>
        <Field label="Format de téléchargement">
          <select
            value={format}
            disabled={busy}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            <option value="csv">CSV</option>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="xls">Excel ancien (.xls)</option>
          </select>
        </Field>
        <div className="toolbar-actions">
          <Button disabled={busy} onClick={() => download()}>
            <Download size={16} /> Exporter {dataset.label.toLowerCase()}
          </Button>
          <Button disabled={busy} onClick={() => download(true)}>
            Télécharger le modèle {format.toUpperCase()}
          </Button>
          <Button disabled={busy} onClick={() => download(false, true)}>
            Télécharger un exemple rempli
          </Button>
        </div>
        <details>
          <summary>Structure attendue et exemple — {dataset.label}</summary>
          <p className="muted small-text">
            Première ligne : noms des colonnes. Une ligne par enregistrement (ou par prestation pour
            les documents). * : obligatoire. Les identifiants des exemples relient les catégories
            entre elles. Remplacez les données fictives avant l’import. Les colonnes facultatives
            peuvent rester vides.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Colonne</th>
                  <th>Champ</th>
                  <th>Exemple fictif</th>
                </tr>
              </thead>
              <tbody>
                {dataset.columns.map(([key, label, required]) => (
                  <tr key={key}>
                    <td>
                      <code>{key}</code>
                      {required ? ' *' : ''}
                    </td>
                    <td>{label}</td>
                    <td>{transferExamples[kind][key] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="muted small-text">
          Ordre conseillé : clients → stock → véhicules → réservations → rendez-vous / commandes /
          documents. CSV UTF-8, XLS ou XLSX ; 1 Mio et 5 000 lignes maximum par fichier. Pour Excel,
          placez les données dans la première feuille. Remplacez les formules par leurs valeurs et
          saisissez les dates en texte ISO comme dans les exemples.
        </p>
        <Field label="Fichier CSV ou Excel à importer">
          <input
            type="file"
            accept=".csv,.xls,.xlsx,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={async (e) => {
              const input = e.currentTarget,
                file = input.files?.[0];
              input.value = '';
              if (!file) return;
              setBusy(true);
              setError('');
              setPreview(null);
              setParsed(null);
              setContent('');
              setFilename('');
              setSheetInfo('');
              setSourceRows({});
              try {
                if (!/\.(csv|xls|xlsx)$/i.test(file.name))
                  throw new Error('Sélectionnez un fichier CSV, XLS ou XLSX.');
                if (file.size > csvMaxBytes)
                  throw new Error('Fichier trop volumineux : maximum 1 Mio.');
                let text: string;
                const buffer = await file.arrayBuffer();
                if (/\.xlsx?$/i.test(file.name)) {
                  const bytes = new Uint8Array(buffer);
                  let binary = '';
                  for (let i = 0; i < bytes.length; i += 8192)
                    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                  const result = await request<{
                    csv: string;
                    sheetName: string;
                    sheetCount: number;
                    rowNumbers?: Record<number, number>;
                  }>('data-transfer/read', { base64: btoa(binary) });
                  text = result.csv;
                  setSourceRows(result.rowNumbers ?? {});
                  setSheetInfo(
                    `Feuille analysée : ${result.sheetName}. ${result.sheetCount > 1 ? 'Les autres feuilles ne seront pas importées.' : ''}`,
                  );
                } else {
                  try {
                    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
                  } catch {
                    throw new Error('Impossible de lire le fichier en UTF-8.');
                  }
                }
                const data = parseCsv(text);
                setContent(text);
                setParsed(data);
                setFilename(file.name);
                setMapping(suggestMapping(kind, data.headers));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </Field>
        {sheetInfo && <p role="status">{sheetInfo}</p>}
        {parsed && (
          <>
            <p>
              {filename} · {parsed.rows.length} ligne(s). Associez les colonnes de votre fichier aux
              champs CaRM.
            </p>
            <div className="form-grid">
              {dataset.columns.map(([key, label, required]) => (
                <Field key={key} label={label + (required ? ' *' : '')}>
                  <select
                    aria-label={`Colonne ${label}`}
                    disabled={busy}
                    value={mapping[key] ?? ''}
                    onChange={(e) => {
                      const next = { ...mapping };
                      if (e.target.value === '') delete next[key];
                      else next[key] = Number(e.target.value);
                      setMapping(next);
                      setPreview(null);
                      setError('');
                    }}
                  >
                    <option value="">{required ? 'Choisir une colonne' : 'Non renseigné'}</option>
                    {parsed.headers.map((header, index) => (
                      <option
                        key={index}
                        value={index}
                        disabled={Object.entries(mapping).some(
                          ([field, column]) => field !== key && column === index,
                        )}
                      >
                        {header}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            {parsed.headers.some((_, index) => !Object.values(mapping).includes(index)) && (
              <p className="muted small-text">
                Colonnes ignorées :{' '}
                {parsed.headers
                  .filter((_, index) => !Object.values(mapping).includes(index))
                  .join(', ')}
                . Leur contenu ne sera pas importé.
              </p>
            )}
            <div className="table-scroll">
              <table className="data-table">
                <caption>Aperçu des cinq premières lignes</caption>
                <thead>
                  <tr>
                    {parsed.headers.slice(0, 6).map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((row, index) => (
                    <tr key={index}>
                      {row.slice(0, 6).map((cell, column) => (
                        <td key={column}>{cell.slice(0, 120)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button disabled={busy || !parsed.rows.length} onClick={analyze}>
              <Upload size={16} /> Analyser avant import
            </Button>
          </>
        )}
        {preview && (
          <div role="status">
            <p>
              <strong>{preview.added} ajout(s)</strong> · {preview.skipped} doublon(s) ignoré(s) ·{' '}
              {preview.errors.length} erreur(s){preview.errors.length === 100 ? ' ou plus' : ''}.
            </p>
            {!!preview.errors.length && (
              <>
                <strong>Fichier invalide : import bloqué</strong>
                <p>
                  Corrigez le fichier puis analysez-le à nouveau. Aucun import ne sera effectué tant
                  que des erreurs restent présentes.
                </p>
                <ul>
                  {preview.errors.map((item, i) => (
                    <li key={i}>
                      Ligne {sourceRows[item.row] ?? item.row} : {item.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!preview.errors.length && preview.added > 0 && (
              <>
                <p>
                  L’import ajoute ces données sans remplacer les fiches existantes. Il sera
                  enregistré en une seule opération.
                </p>
                <Button className="primary" disabled={busy} onClick={confirm}>
                  Confirmer l’import de {preview.added} enregistrement(s)
                </Button>
              </>
            )}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
