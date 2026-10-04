# MIDI KEY

Un sintetizador local para tocar desde un Akai USB MIDI en tu Mac. No necesita instalar paquetes, crear cuentas ni configurar claves de API.

## Abrir

Haz doble clic en **Abrir MIDI Key.command**. Se abre Google Chrome en `http://localhost:4317`. Deja abierta la ventana del servidor mientras tocas. Para detenerlo, pulsa Ctrl+C en esa ventana.

También puedes ejecutar `npm start`, o `node server.mjs`, desde esta carpeta si tienes Node.js en el PATH.

## Tocar

1. Conecta el Akai por USB al Mac (cable de datos; adaptador USB-C si corresponde).
2. Pulsa **Activar audio**, después **Conectar MIDI** y permite el acceso MIDI en Chrome.
3. Elige el puerto Akai si hay varios y selecciona un sonido.

El sonido se genera con Web Audio y sale por el dispositivo de audio del Mac. El teclado transmite notas MIDI; no necesita producir audio por sí mismo. El banco incluye síntesis de teclas, no muestras de piano acústico.

Puedes probar con el ratón, una pantalla táctil o las teclas A S D F G H J K (blancas), W E T Y U (negras). Z/X cambian la octava del teclado virtual; las notas de tu Akai conservan su octava MIDI. El sintetizador permite 24 voces, velocidad, pedal sustain (CC64), vibrato con la rueda de modulación (CC1) y pitch bend ±2 semitonos. La transposición del sonido está en Ajustes avanzados.

**Silencio** o Escape detienen las notas. Cambiar de sonido, desconectar MIDI o abandonar la ventana libera las notas para evitar que se queden sonando. Safari y algunos navegadores integrados no ofrecen Web MIDI: utiliza Chrome para conectar hardware. La página debe abrirse en localhost, no como archivo HTML.

## Crear sonidos desde el chat

Pide un sonido en este mismo chat de Codex, por ejemplo:

> Añade un pad oscuro con ataque lento, poco brillo y una cola de reverb larga.

Codex puede añadir o modificar sonidos en `data/presets.json`. La interfaz consulta el banco cada dos segundos y muestra las nuevas incorporaciones automáticamente; selecciona el último sonido añadido. No hace falta reiniciar el servidor. Mantén JSON válido y usa un ID único por sonido.

El cuadro de descripción de la interfaz utiliza **recetas locales deterministas**, sin un modelo de IA ni llamadas externas. Reconoce tipos de sonido y palabras como cálido, brillante, espacial, corto, lento, eco, agresivo y sin efectos. Para diseño más específico, utiliza el chat de Codex.

Los sonidos creados o guardados en la interfaz se escriben en `data/user-presets.json`. Ese archivo se conserva al reiniciar. Puedes exportar e importar un sonido individual en JSON. Guardar un sonido editado crea una copia con nombre propio.

## Formato de sonido

```json
{
  "id": "pad-nocturno",
  "name": "Medianoche",
  "category": "Pad",
  "description": "Un pad oscuro que respira lentamente.",
  "params": {
    "wave": "sawtooth", "wave2": "triangle", "mix": 0.45,
    "detune": 10, "sub": 0.1,
    "attack": 1.1, "decay": 0.8, "sustain": 0.7, "release": 3.5,
    "cutoff": 1100, "resonance": 0.7, "filterEnv": 0.2,
    "vibrato": 3, "reverb": 0.6, "delay": 0.15,
    "drive": 0.05, "octave": 0
  }
}
```

Los parámetros omitidos usan valores predeterminados y los valores numéricos se limitan a rangos seguros. `public/patches.js` documenta los rangos. El servidor solo escucha en 127.0.0.1; no publica el banco en Internet. Las fuentes visuales se cargan desde Google Fonts con una alternativa del sistema; el audio y los sonidos funcionan sin conexión.

## Comprobar

`npm test` ejecuta las pruebas del banco, mensajes MIDI y servidor local. La conexión física con el Akai debe comprobarse con el teclado conectado y el permiso MIDI concedido.
