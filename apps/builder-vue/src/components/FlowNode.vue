<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';

defineProps<{
  id: string;
  data: {
    type: string;
    title: string;
    message?: string;
    options?: string[];
    color?: string;
  };
  selected?: boolean;
}>();

const labels: Record<string, string> = {
  TRIGGER: 'Disparador',
  MESSAGE: 'Mensaje',
  BUTTONS: 'Botones',
  QUESTION: 'Pregunta',
  CONDITION: 'Condición',
  HTTP_REQUEST: 'Consulta API',
  HANDOFF: 'Agente humano',
  END: 'Fin'
};
</script>

<template>
  <div class="flow-node" :class="{ 'is-selected': selected }" :style="{ '--node-color': data.color || '#64748b' }">
    <Handle type="target" :position="Position.Left" class="node-handle" />
    <div class="node-heading">
      <span class="node-icon">{{ data.type === 'BUTTONS' ? '☷' : data.type === 'CONDITION' ? '◇' : data.type === 'HANDOFF' ? '♧' : '●' }}</span>
      <span class="node-kind">{{ labels[data.type] || data.type }}</span>
      <span class="node-status"></span>
    </div>
    <div class="node-title">{{ data.title || labels[data.type] }}</div>
    <p v-if="data.message" class="node-preview">{{ data.message }}</p>
    <div v-if="data.options?.length" class="node-options">
      <span v-for="option in data.options" :key="option">{{ option }}</span>
    </div>
    <Handle type="source" :position="Position.Right" class="node-handle" />
  </div>
</template>