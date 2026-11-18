import {
  BusinessHoursDay,
  FlowEdge,
  FlowNode,
  QuickReplyInput
} from '@bothub/shared';

export function createDefaultBusinessHours(): BusinessHoursDay[] {
  return [
    { dayOfWeek: 0, isOpen: false, openTime: '09:00', closeTime: '14:00' },
    { dayOfWeek: 1, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 2, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 3, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 4, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 5, isOpen: true, openTime: '08:00', closeTime: '18:00' },
    { dayOfWeek: 6, isOpen: true, openTime: '09:00', closeTime: '13:00' }
  ];
}

export function createDefaultQuickReplies(): Required<QuickReplyInput>[] {
  return [
    {
      id: 'qr-horario',
      title: 'Horarios de Atención',
      keywords: ['horario', 'horarios', 'abiertos', 'atencion'],
      responseText:
        'Atendemos de lunes a viernes de 08:00 a 18:00 y sábados de 09:00 a 13:00 (Hora Colombia/Bogotá).',
      matchMode: 'CONTAINS',
      isActive: true
    },
    {
      id: 'qr-ubicacion',
      title: 'Sedes y Cobertura',
      keywords: ['ubicacion', 'direccion', 'sede', 'envios'],
      responseText:
        'Realizamos despachos nacionales en 24-48h hábiles y contamos con atención digital 24/7.',
      matchMode: 'CONTAINS',
      isActive: true
    },
    {
      id: 'qr-humano',
      title: 'Hablar con Asesor',
      keywords: ['asesor', 'humano', 'agente', 'ayuda'],
      responseText:
        'Escribe "3" en el menú principal o "asesor" para transferirte con un especialista en Chatwoot.',
      matchMode: 'CONTAINS',
      isActive: true
    }
  ];
}

export function createSalesFlowGraph(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    {
      id: 'node-trigger-1',
      type: 'TRIGGER',
      position: { x: 60, y: 180 },
      data: {
        title: 'Inicio / Palabra Clave',
        matchMode: 'FIRST_MESSAGE',
        keyword: 'hola, menu, inicio',
        description: 'Se activa en el primer mensaje o al escribir "hola" o "menu".'
      }
    },
    {
      id: 'node-msg-welcome',
      type: 'MESSAGE',
      position: { x: 340, y: 80 },
      data: {
        title: 'Bienvenida Personalizada',
        text: '¡Hola {{nombre}}! 👋 Bienvenido a *BotHub Enterprise*. Antes de continuar, confirmemos tus datos.',
        mediaType: 'none',
        mediaUrl: ''
      }
    },
    {
      id: 'node-q-cedula',
      type: 'QUESTION',
      position: { x: 640, y: 80 },
      data: {
        title: 'Capturar Cédula / NIT',
        promptText:
          'Por favor escribe tu número de documento o cédula (solo números, 6 a 12 dígitos):',
        variableName: 'cedula',
        validationType: 'NATIONAL_ID',
        maxRetries: 3,
        errorMessage:
          'El documento ingresado no es válido. Ingresa entre 6 y 12 dígitos numéricos.'
      }
    },
    {
      id: 'node-buttons-menu',
      type: 'BUTTONS',
      position: { x: 950, y: 80 },
      data: {
        title: 'Menú Principal Interactivo',
        bodyText: 'Gracias {{nombre}} (Doc: {{cedula}}). ¿En qué podemos ayudarte hoy?',
        buttons: [
          { id: 'btn-ventas', label: '1. Cotizar Plan' },
          { id: 'btn-estado', label: '2. Consultar Pedido' },
          { id: 'btn-asesor', label: '3. Hablar con Asesor' }
        ]
      }
    },
    {
      id: 'node-ai-sales',
      type: 'AI_PROMPT',
      position: { x: 1280, y: 0 },
      data: {
        title: 'Asistente IA Comercial',
        systemPrompt:
          'Eres el consultor experto de BotHub. Recomienda el plan ideal para WhatsApp + Chatwoot usando las variables del cliente.',
        model: 'gpt-4o-mini',
        temperature: 0.4,
        saveToVariable: 'respuesta_ia'
      }
    },
    {
      id: 'node-http-order',
      type: 'HTTP_REQUEST',
      position: { x: 1280, y: 170 },
      data: {
        title: 'Consultar ERP / Pedido',
        method: 'GET',
        url: 'https://api.bothub.local/v1/orders?document={{cedula}}',
        responseVariable: 'estado_pedido',
        timeoutMs: 5000
      }
    },
    {
      id: 'node-tag-vip',
      type: 'ASSIGN_TAG',
      position: { x: 1280, y: 340 },
      data: {
        title: 'Etiquetar Lead Prioritario',
        action: 'ADD',
        tags: ['lead-calificado', 'requiere-agente']
      }
    },
    {
      id: 'node-handoff-cw',
      type: 'HANDOFF',
      position: { x: 1580, y: 340 },
      data: {
        title: 'Transferir a Chatwoot',
        teamName: 'Ventas & Onboarding',
        clientMessage:
          'Te estamos transfiriendo con un especialista de nuestro equipo en Chatwoot. En breve te atenderán.',
        privateNoteTemplate:
          'Handoff solicitado por {{nombre}} (Cédula: {{cedula}}). Última consulta: {{ultimo_mensaje}}'
      }
    },
    {
      id: 'node-end-1',
      type: 'END',
      position: { x: 1580, y: 90 },
      data: {
        title: 'Finalizar Flujo',
        farewellMessage:
          '¡Gracias por comunicarte con BotHub! Si necesitas algo más escribe *menu*.'
      }
    }
  ];

  const edges: FlowEdge[] = [
    { id: 'e-1', source: 'node-trigger-1', target: 'node-msg-welcome', label: 'Inicio' },
    { id: 'e-2', source: 'node-msg-welcome', target: 'node-q-cedula', label: 'Continuar' },
    { id: 'e-3', source: 'node-q-cedula', target: 'node-buttons-menu', label: 'Cédula válida' },
    {
      id: 'e-4',
      source: 'node-buttons-menu',
      target: 'node-ai-sales',
      sourceHandle: 'btn-ventas',
      label: '1. Cotizar Plan'
    },
    {
      id: 'e-5',
      source: 'node-buttons-menu',
      target: 'node-http-order',
      sourceHandle: 'btn-estado',
      label: '2. Consultar Pedido'
    },
    {
      id: 'e-6',
      source: 'node-buttons-menu',
      target: 'node-tag-vip',
      sourceHandle: 'btn-asesor',
      label: '3. Hablar con Asesor'
    },
    { id: 'e-7', source: 'node-ai-sales', target: 'node-end-1', label: 'Cierre IA' },
    { id: 'e-8', source: 'node-http-order', target: 'node-end-1', label: 'Respuesta ERP' },
    { id: 'e-9', source: 'node-tag-vip', target: 'node-handoff-cw', label: 'Pasar a Agente' }
  ];

  return { nodes, edges };
}

export function createSupportFlowGraph(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = [
    {
      id: 'sup-trigger',
      type: 'TRIGGER',
      position: { x: 80, y: 140 },
      data: {
        title: 'Trigger Soporte Técnico',
        matchMode: 'CONTAINS',
        keyword: 'soporte, falla, ticket, error'
      }
    },
    {
      id: 'sup-list',
      type: 'LIST',
      position: { x: 380, y: 140 },
      data: {
        title: 'Categoría de Soporte',
        bodyText:
          'Selecciona el componente sobre el cual necesitas asistencia técnica:',
        buttonText: 'Ver Categorías',
        items: [
          {
            id: 'cat-qr',
            title: '1. Reconexión QR Baileys',
            description: 'Problemas de sesión o escaneo QR'
          },
          {
            id: 'cat-cw',
            title: '2. Webhook Chatwoot',
            description: 'Sincronización de mensajes o handoff'
          },
          {
            id: 'cat-urgente',
            title: '3. Incidencia Crítica',
            description: 'Escalar a ingeniero de guardia'
          }
        ]
      }
    },
    {
      id: 'sup-condition',
      type: 'CONDITION',
      position: { x: 700, y: 140 },
      data: {
        title: '¿Es Incidencia Crítica?',
        variableName: 'ultima_opcion',
        operator: 'CONTAINS',
        compareValue: '3'
      }
    },
    {
      id: 'sup-delay',
      type: 'DELAY',
      position: { x: 1020, y: 40 },
      data: {
        title: 'Pausa Escribiendo...',
        delaySeconds: 2,
        showTyping: true
      }
    },
    {
      id: 'sup-handoff',
      type: 'HANDOFF',
      position: { x: 1020, y: 240 },
      data: {
        title: 'Escalar a Nivel 2 (Chatwoot)',
        teamName: 'Ingeniería N2',
        clientMessage:
          'Hemos marcado tu caso como prioritario y transferido tu conversación a Ingeniería N2.',
        privateNoteTemplate:
          'Escalamiento técnico crítico para {{nombre}} ({{telefono}}).'
      }
    },
    {
      id: 'sup-msg-guide',
      type: 'MESSAGE',
      position: { x: 1320, y: 40 },
      data: {
        title: 'Guía de Diagnóstico Automático',
        text: 'Puedes verificar el estado de tu sesión en la pestaña *Bots -> Ver QR / Estado* o probar la conexión con Chatwoot en un clic.'
      }
    }
  ];

  const edges: FlowEdge[] = [
    { id: 'se-1', source: 'sup-trigger', target: 'sup-list', label: 'Entrada' },
    { id: 'se-2', source: 'sup-list', target: 'sup-condition', label: 'Selección' },
    {
      id: 'se-3',
      source: 'sup-condition',
      target: 'sup-handoff',
      sourceHandle: 'true',
      label: 'Sí (Crítico)'
    },
    {
      id: 'se-4',
      source: 'sup-condition',
      target: 'sup-delay',
      sourceHandle: 'false',
      label: 'No (Autogestión)'
    },
    { id: 'se-5', source: 'sup-delay', target: 'sup-msg-guide', label: 'Enviar guía' }
  ];

  return { nodes, edges };
}
