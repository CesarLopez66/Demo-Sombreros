'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { InsigniaFactura } from '@/components/Insignias';
import { fmtBs } from '@/lib/formato';
import { useEstado } from '@/lib/store';

const NIT_EMISOR = '1020304025'; // demo

export default function Ticket() {
  const { id } = useParams<{ id: string }>();
  const e = useEstado();
  const v = e.ventas.find((x) => x.id === id);
  const [qr, setQr] = useState('');

  const urlQr = v
    ? `https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=${NIT_EMISOR}&cuf=${v.factura.cuf}&numero=${v.factura.numero}&t=2`
    : '';
  useEffect(() => {
    if (urlQr) QRCode.toDataURL(urlQr, { margin: 0, width: 132 }).then(setQr);
  }, [urlQr]);

  if (!v) return <p className="muted">Venta no encontrada.</p>;
  const suc = e.sucursales.find((s) => s.codigo === v.sucursal)!;
  const efectivo = v.pagos.find((p) => p.metodo === 'efectivo');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, alignItems: 'start', maxWidth: 980, margin: '0 auto' }}>
      <div className="card card-pad pila" style={{ gap: 14 }}>
        <span className="badge badge-bien" style={{ justifySelf: 'start' }}>✓ Venta completada</span>
        <h1 className="num">{fmtBs(v.total)}</h1>
        {efectivo?.recibido ? <p className="num muted">Recibido {fmtBs(efectivo.recibido)} · Cambio {fmtBs(efectivo.recibido - v.total)}</p> : null}
        <div className="fila"><span className="muted">Factura</span><InsigniaFactura estado={v.factura.estado} /></div>
        <p className="muted">
          {v.factura.tipoEmision === 'en_linea'
            ? 'Emitida en línea: el microservicio fiscal la envía al SIN y la valida en segundos.'
            : 'Emitida fuera de línea (contingencia). Al volver la conexión se registra el evento significativo y viaja en un paquete al SIN.'}
        </p>
        <div className="fila">
          <button className="btn" onClick={() => window.print()}>Imprimir ticket</button>
          <Link className="btn btn-primario" href="/pos/venta">Nueva venta</Link>
        </div>
        <p className="tenue">En la Fase 2 la impresión irá directo a la térmica de 80 mm por WebUSB (ESC/POS); aquí usa el diálogo del navegador.</p>
      </div>

      <div className="ticket" aria-label="Vista previa del ticket de 80 mm">
        <div className="centro">
          <strong>SOMBRERERÍA (DEMO)</strong><br />
          {suc.nombre}<br />
          Punto de venta {v.caja === 'CAJA-01' ? 0 : 1}<br />
          NIT {NIT_EMISOR}
        </div>
        <hr />
        <div className="centro"><strong>FACTURA</strong><br />CON DERECHO A CRÉDITO FISCAL</div>
        <hr />
        <div>Nº factura: {v.factura.numero}</div>
        <div style={{ wordBreak: 'break-all' }}>CUF: {v.factura.cuf}</div>
        <div>Fecha: {new Date(v.fecha).toLocaleString('es-BO')}</div>
        <div>{v.cliente?.tipoDocumento}: {v.cliente?.documento}</div>
        <div>Nombre: {v.cliente?.razonSocial}</div>
        <hr />
        {v.lineas.map((l) => (
          <div key={l.sku} style={{ marginBottom: 4 }}>
            <div>{l.descripcion}</div>
            <div className="linea"><span>{l.cantidad} x {l.precio.toFixed(2)}</span><span>{(l.cantidad * l.precio).toFixed(2)}</span></div>
          </div>
        ))}
        <hr />
        <div className="linea"><span>SUBTOTAL Bs</span><span>{v.subtotal.toFixed(2)}</span></div>
        {v.descuento > 0 && <div className="linea"><span>DESCUENTO Bs</span><span>{v.descuento.toFixed(2)}</span></div>}
        <div className="linea"><strong>TOTAL Bs</strong><strong>{v.total.toFixed(2)}</strong></div>
        <div className="linea"><span>IMPORTE BASE CRÉDITO FISCAL</span><span>{v.total.toFixed(2)}</span></div>
        <div>Pago: {v.pagos.map((p) => p.metodo.toUpperCase()).join(' + ')}</div>
        <hr />
        <div className="centro" style={{ fontSize: 10.5 }}>
          ESTA FACTURA CONTRIBUYE AL DESARROLLO DEL PAÍS, EL USO ILÍCITO SERÁ SANCIONADO PENALMENTE DE ACUERDO A LEY
        </div>
        <div className="centro" style={{ fontSize: 10.5, marginTop: 6 }}>
          [Leyenda asignada del catálogo del SIN]
        </div>
        {v.factura.tipoEmision === 'fuera_de_linea' && (
          <div className="centro" style={{ fontSize: 10.5, marginTop: 6 }}>
            “Este documento es la Representación Gráfica de un Documento Fiscal Digital emitido fuera de línea, verifique su envío con su proveedor o en la página web www.impuestos.gob.bo”
          </div>
        )}
        <div className="centro" style={{ marginTop: 10 }}>{qr && <img src={qr} width={132} height={132} alt="QR de verificación del SIN" />}</div>
        <div className="centro" style={{ fontSize: 10.5 }}>Venta #{v.numero} · {v.cajero}</div>
      </div>
    </div>
  );
}
