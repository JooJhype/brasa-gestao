export function createOrdersUI({
  api,
  getState,
  modal,
  field,
  select,
  numberField,
  esc,
  money,
  toast,
  load,
}) {
  const labels = {
    new: 'Recebido',
    preparing: 'Em preparo',
    ready: 'Pronto',
    out_for_delivery: 'Em entrega',
    completed: 'Finalizado',
    canceled: 'Cancelado',
  };
  const modes = { delivery: 'Entrega', takeout: 'Retirada', dine_in: 'Salão' };
  let channel = 'all';
  const active = (o) => !['completed', 'canceled'].includes(o.status);
  const button = (label, action, id = '', cls = 'secondary') =>
    `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const orderById = (id) => (getState().orders || []).find((o) => o.id === id);
  const time = (value) =>
    value
      ? new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value))
      : '—';
  const channelLabel = (o) =>
    getState().platforms.find((p) => p.id === o.platformId)?.name || 'Venda direta';
  const next = (o) =>
    ({
      new: ['preparing', 'Iniciar preparo'],
      preparing: ['ready', 'Marcar como pronto'],
      ready:
        o.fulfillment === 'delivery'
          ? ['out_for_delivery', 'Saiu para entrega']
          : [
              'completed',
              o.fulfillment === 'dine_in' ? 'Finalizar atendimento' : 'Finalizar retirada',
            ],
      out_for_delivery: ['completed', 'Confirmar entrega'],
    })[o.status];
  function view() {
    const all = (getState().orders || []).filter(active),
      platforms = getState().platforms;
    if (channel !== 'all' && !platforms.some((p) => p.id === channel)) channel = 'all';
    const list = all.filter((o) => channel === 'all' || o.platformId === channel);
    return (
      /* HTML */ `<div class="page-head"><div><div class="eyebrow">COZINHA E EXPEDIÇÃO</div><h1>Pedidos</h1><p>Cadastre o pedido e acompanhe cada etapa até a entrega ou retirada.</p></div><div class="actions">${button('+ Novo pedido', 'order-new', '', 'primary')}</div></div>` +
      /* HTML */ `<div class="order-toolbar">
        <div class="order-live">
          <span class="order-count-dot"></span>${all.length}
          ${all.length === 1 ? 'pedido em andamento' : 'pedidos em andamento'}
        </div>
        <label
          >Canal
          <select id="order-channel">
            ${[['all', 'Todos os canais'], ...platforms.map((p) => [p.id, p.name])].map(([id, name]) => `<option value="${esc(id)}" ${channel === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}
          </select></label
        ><a href="#sales" class="text-button">Ver finalizados e cancelados →</a>
      </div>` +
      /* HTML */ `<div class="order-board">
          ${['new', 'preparing', 'ready', 'out_for_delivery']
            .map((status) => {
              const rows = list.filter((o) => o.status === status);
              return /* HTML */ `<section class="order-lane">
                <div class="order-lane-head">
                  <h2>${labels[status]}</h2>
                  <span>${rows.length}</span>
                </div>
                <div class="order-lane-body">
                  ${rows.length ? rows.map(card).join('') : '<p class="order-lane-empty">Nenhum pedido nesta etapa</p>'}
                </div>
              </section>`;
            })
            .join('')}
        </div>
        <p class="hint">
          O estoque é baixado uma vez ao iniciar o preparo. Finalizados e cancelados ficam em
          Vendas. Todos os pedidos são cadastrados aqui; o canal selecionado serve para registrar a
          venda e calcular suas taxas.
        </p>`
    );
  }
  function card(o) {
    const needsProduct = o.lines.some((l) => !l.productId);
    return /* HTML */ `<article class="order-card ${needsProduct ? 'needs-mapping' : ''}">
      <div class="order-card-top">
        <span class="order-source">${esc(channelLabel(o))}</span
        ><span class="small muted">${time(o.createdAt)}</span>
      </div>
      <h3>#${esc(o.number)}</h3>
      <div class="order-customer">${esc(o.customer.name || 'Cliente não informado')}</div>
      <span class="small muted"
        >${modes[o.fulfillment]}${o.scheduledAt ? ' · Agendado ' + time(o.scheduledAt) : ''}</span
      >
      <ul class="order-items">
        ${o.lines
          .slice(0, 3)
          .map((l) => `<li><b>${l.quantity}×</b> ${esc(l.name)}</li>`)
          .join(
            '',
          )}${o.lines.length > 3 ? `<li class="muted">+ ${o.lines.length - 3} itens</li>` : ''}
      </ul>
      ${o.note ? `<p class="order-note">${esc(o.note)}</p>` : ''}${needsProduct ? '<p class="mapping-warning">Vincule os itens às fichas antes do preparo.</p>' : ''}${button('Abrir pedido', 'order-detail', o.id, 'primary')}
    </article>`;
  }
  function attach() {
    document.querySelector('#order-channel')?.addEventListener('change', (e) => {
      channel = e.target.value;
      load().catch((e) => toast(e.message));
    });
  }
  function lineRow(p) {
    return /* HTML */ `<div class="order-entry-row">
      <select class="order-product" aria-label="Produto" required>
        ${getState()
          .products.map(
            (item) =>
              `<option value="${item.id}" ${p?.id === item.id ? 'selected' : ''}>${esc(item.name)}</option>`,
          )
          .join('')}</select
      ><input
        class="order-quantity"
        type="number"
        min="1"
        max="999"
        step="1"
        value="1"
        aria-label="Quantidade"
        required
      /><input
        class="order-price"
        type="number"
        min="0"
        step="0.01"
        value="${p?.price || 0}"
        aria-label="Preço unitário"
        required
      /><button type="button" class="icon-button order-remove" aria-label="Remover item">×</button
      ><input
        class="order-line-note"
        maxlength="2000"
        placeholder="Preparo: sem cebola, ponto da carne, adicionais…"
        aria-label="Observações de preparo"
      />
    </div>`;
  }
  function newOrder() {
    const state = getState();
    if (!state.products.length) {
      toast('Crie uma ficha técnica antes de cadastrar pedidos.');
      location.hash = 'products';
      return;
    }
    modal(
      'Novo pedido',
      /* HTML */ `<div class="form-grid">
          ${select(
            'Canal de venda',
            'platformId',
            state.platforms.map((p) => [p.id, p.name]),
            state.platforms[0].id,
          )}
          ${select('Entrega / retirada', 'fulfillment', Object.entries(modes), 'delivery')}
          ${field('Nome do cliente', 'customerName', 'text', '', 'required maxlength="120"')}
          ${field('Telefone', 'phone', 'tel', '', 'maxlength="50"')}
          ${field('Endereço completo', 'address', 'text', '', 'maxlength="500"')}
          ${field('Bairro', 'neighborhood', 'text', '', 'maxlength="120"')}
          ${field('Cidade', 'city', 'text', '', 'maxlength="120"')}
          ${field('Complemento', 'complement', 'text', '', 'maxlength="200"')}
          ${field('Referência para entrega', 'reference', 'text', '', 'maxlength="300"')}
          ${field('CEP', 'postalCode', 'text', '', 'maxlength="30"')}
          ${field('Entregador / responsável', 'courier', 'text', '', 'maxlength="120"')}
          ${field('Pagamento', 'paymentMethod', 'text', 'Pix', 'maxlength="80"')}
          <label class="check-row"
            ><input name="prepaid" type="checkbox" checked /><span
              >Pagamento já realizado</span
            ></label
          ><label class="field"
            >Troco para (R$)<input name="changeFor" type="number" min="0" step="0.01" /></label
          >${field('Agendamento (opcional)', 'scheduledAt', 'datetime-local')}
          <label class="field full"
            >Observação do pedido<textarea name="note" maxlength="2000" rows="2"></textarea>
          </label>
        </div>
        <div class="divider"></div>
        <div class="row-labels sale">
          <span>Produto</span><span>Qtd.</span><span>Preço un.</span><span></span>
        </div>
        <div id="order-entry-lines">${lineRow(state.products[0])}</div>
        <button type="button" id="order-add-line" class="text-button">
          + Adicionar produto / adicional
        </button>
        <div class="form-grid">
          ${numberField('Desconto pago pela loja (R$)', 'discount', 0)}
          ${numberField('Logística / outras taxas (R$)', 'extraFee', 0)}
        </div>
        <p class="hint">
          Adicionais que consomem estoque precisam de uma ficha própria e uma linha no pedido.
          Observações não alteram a ficha padrão automaticamente.
        </p>`,
      async (form) => {
        const values = Object.fromEntries(new FormData(form));
        const lines = [...form.querySelectorAll('.order-entry-row')].map((row) => ({
          productId: row.querySelector('.order-product').value,
          quantity: Number(row.querySelector('.order-quantity').value),
          unitPrice: Number(row.querySelector('.order-price').value),
          note: row.querySelector('.order-line-note').value,
        }));
        await api('orders', {
          source: 'manual',
          platformId: values.platformId,
          fulfillment: values.fulfillment,
          customer: { name: values.customerName, phone: values.phone },
          delivery: {
            address: values.address,
            neighborhood: values.neighborhood,
            city: values.city,
            complement: values.complement,
            reference: values.reference,
            postalCode: values.postalCode,
            courier: values.courier,
          },
          payment: {
            method: values.paymentMethod,
            prepaid: form.querySelector('[name=prepaid]').checked,
            changeFor: values.changeFor === '' ? null : Number(values.changeFor),
          },
          scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : null,
          note: values.note,
          discount: Number(values.discount),
          extraFee: Number(values.extraFee),
          lines,
        });
      },
      (form) => {
        form.querySelector('button[type=submit]').textContent = 'Cadastrar pedido';
        form.querySelector('#order-add-line').onclick = () =>
          form
            .querySelector('#order-entry-lines')
            .insertAdjacentHTML('beforeend', lineRow(state.products[0]));
        form.addEventListener('click', (e) => {
          const b = e.target.closest('.order-remove');
          if (b) {
            const row = b.closest('.order-entry-row');
            if (row.parentElement.children.length > 1) row.remove();
          }
        });
        form.addEventListener('change', (e) => {
          if (e.target.classList.contains('order-product')) {
            const p = state.products.find((p) => p.id === e.target.value);
            e.target.closest('.order-entry-row').querySelector('.order-price').value = p.price;
          }
        });
      },
      'Pedido cadastrado.',
    );
  }
  function detail(id) {
    const o = orderById(id);
    if (!o) return;
    const transition = next(o),
      state = getState();
    const preparation = o.preparation?.length
      ? o.preparation
      : o.lines
          .filter((l) => l.productId)
          .flatMap((l) => {
            const p = state.products.find((p) => p.id === l.productId);
            return (p?.recipe || []).map((row) => ({
              name: state.ingredients.find((i) => i.id === row.ingredientId)?.name,
              quantity: row.quantity * l.quantity,
              unit: row.unit,
            }));
          });
    const content = /* HTML */ `<div class="kitchen-top">
        <span class="order-source">${esc(channelLabel(o))}</span
        ><span class="badge neutral">${labels[o.status]}</span
        ><strong>${modes[o.fulfillment]}</strong>
      </div>
      ${o.scheduledAt ? `<div class="notice">Agendado: ${time(o.scheduledAt)}</div>` : ''}
      <div class="kitchen-customer">
        <h3>${esc(o.customer.name || 'Cliente não informado')}</h3>
        <p>${esc(o.customer.phone)}</p>
        ${
          o.fulfillment === 'delivery'
            ? /* HTML */ `<p>
                  ${esc(o.delivery.address || 'Endereço não informado')}
                  ${esc(o.delivery.complement)}
                </p>
                <p>
                  ${esc([o.delivery.neighborhood, o.delivery.city, o.delivery.postalCode].filter(Boolean).join(' · '))}
                </p>
                ${o.delivery.reference ? `<p><strong>Referência:</strong> ${esc(o.delivery.reference)}</p>` : ''}${o.delivery.courier ? `<p><strong>Entregador:</strong> ${esc(o.delivery.courier)}</p>` : ''}`
            : ''
        }
        <p>
          <strong>Pagamento:</strong> ${esc(o.payment.method || 'Não informado')} ·
          ${o.payment.prepaid ? 'Já pago' : 'Cobrar na entrega / retirada'}${o.payment.changeFor !== null ? ` · Troco para ${money(o.payment.changeFor)}` : ''}
        </p>
      </div>
      <h3>Preparar</h3>
      <div class="kitchen-items">
        ${o.lines
          .map(
            (l, index) =>
              /* HTML */ `<div class="kitchen-item">
                <strong><span>${l.quantity}×</span> ${esc(l.name)}</strong
                >${l.note ? `<p class="kitchen-note">${esc(l.note)}</p>` : ''}${
                  o.status === 'new'
                    ? /* HTML */ `<label class="field small"
                        >Ficha técnica<select data-map-index="${index}">
                          <option value="">Selecione a ficha deste item</option>
                          ${state.products.map((p) => `<option value="${p.id}" ${l.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                        </select></label
                      >`
                    : ''
                }
              </div>`,
          )
          .join('')}
      </div>
      ${o.note ? `<div class="kitchen-notice"><strong>Observação do pedido</strong><p>${esc(o.note)}</p></div>` : ''}${
        preparation.length
          ? /* HTML */ `<details class="kitchen-recipe">
              <summary>Ingredientes das fichas · pedido completo</summary>
              ${preparation.map((r) => `<div class="flow-row"><span>${esc(r.name || r.ingredientName)}</span><strong>${Number(r.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${esc(r.unit)}</strong></div>`).join('')}
              <p class="hint">
                Confira observações e restrições. A baixa usa a ficha padrão; adicionais com estoque
                entram como itens próprios.
              </p>
            </details>`
          : ''
      }
      <details class="order-history">
        <summary>Histórico do pedido</summary>
        ${o.history.map((h) => `<p>${time(h.at)} · ${labels[h.status] || esc(h.status)} ${esc(h.note || '')}</p>`).join('')}
      </details>`;
    modal(
      `Pedido #${esc(o.number)}`,
      content,
      async (form) => {
        if (!transition) return;
        if (o.status === 'new')
          for (const select of form.querySelectorAll('[data-map-index]')) {
            if (!select.value)
              throw Error('Vincule todos os itens às fichas técnicas antes de iniciar o preparo.');
            const index = Number(select.dataset.mapIndex);
            if (o.lines[index].productId !== select.value)
              await api('orders/map', { id: o.id, index, productId: select.value });
          }
        await api('orders/transition', { id: o.id, status: transition[0] });
      },
      (form) => {
        const submit = form.querySelector('button[type=submit]');
        submit.textContent = transition?.[1] || 'Fechar';
        if (!transition) submit.hidden = true;
        if (active(o))
          form
            .querySelector('.form-actions')
            .insertAdjacentHTML(
              'afterbegin',
              button('Cancelar pedido', 'order-cancel', o.id, 'text-button danger'),
            );
      },
      'Pedido atualizado.',
    );
  }
  async function cancel(id) {
    const o = orderById(id);
    if (!o) return;
    document.querySelector('#dialog').close();
    const reasonField = field(
      'Motivo do cancelamento',
      'reason',
      'text',
      '',
      'required maxlength="500"',
    );
    modal(
      'Cancelar pedido',
      `${o.saleId ? '<div class="notice">O preparo já baixou o estoque. Ingredientes utilizados serão registrados como perda.</div><label class="check-row"><input type="checkbox" name="restock"><span>Os ingredientes não foram utilizados e podem voltar ao estoque</span></label>' : '<p>Este pedido será arquivado como cancelado. O estoque ainda não foi baixado.</p>'}${reasonField}`,
      async (form) => {
        await api('orders/transition', {
          id,
          status: 'canceled',
          reason: form.querySelector('[name=reason]').value,
          restock: form.querySelector('[name=restock]')?.checked || false,
        });
      },
      (form) => {
        form.querySelector('button[type=submit]').textContent = 'Confirmar cancelamento';
      },
      'Pedido cancelado.',
    );
  }
  async function handleAction(action, id) {
    if (!['order-new', 'order-detail', 'order-cancel'].includes(action)) return false;
    if (action === 'order-new') newOrder();
    if (action === 'order-detail') detail(id);
    if (action === 'order-cancel') await cancel(id);
    return true;
  }
  return { view, attach, handleAction };
}
