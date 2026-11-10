// Textos del asistente de uso. Cada paso apunta a un elemento con data-guide="<target>".
// Los pasos cuyo elemento no existe en pantalla se descartan al iniciar el recorrido,
// así que aquí se describen todos y la pantalla decide cuáles aplican.

// Recorrido general: se muestra una vez por sesión, antes de la guía de la primera pantalla.
export function generalSteps(ctx) {
  return [
    {
      title: '¡Bienvenido al Laboratorio de imágenes!',
      body: 'Aquí mejoras la calidad de una imagen, le quitas el fondo, eliminas objetos y la conviertes en vector para abrirla en Illustrator o CorelDRAW. No tiene costo por uso y tus imágenes se procesan en tu propio equipo: nunca se suben a un servidor.',
      note: 'Avanza con "Siguiente" o con las flechas del teclado. "Saltar" cierra la guía de esta pantalla. Si ya no la necesitas, marca "No volver a mostrar el asistente" abajo.',
    },
    ...(!ctx.isWide ? [{
      target: 'menu-button', title: 'Botón de menú',
      body: 'Toca este botón para abrir el menú lateral y cambiar de herramienta. Se cierra al elegir una opción, tocando fuera o con la ×.',
    }] : []),
    {
      target: 'menu-tools', menu: true, title: 'Herramientas',
      body: 'Cada herramienta hace un trabajo distinto sobre la misma imagen:',
      list: [
        ['Mejorar calidad', 'agranda la imagen y le devuelve nitidez.'],
        ['Quitar fondo', 'deja el objeto sobre transparente.'],
        ['Quitar objetos', 'borra lo que pintes y rellena con lo que hay alrededor.'],
        ['Vectorizar', 'convierte la imagen en SVG o PDF editable.'],
      ],
      note: 'La imagen que cargues se conserva al cambiar de herramienta, así puedes encadenar pasos: por ejemplo mejorarla, quitarle el fondo y luego vectorizarla.',
    },
    {
      target: 'menu-account', menu: true, title: 'Ayuda',
      body: 'Aquí está el interruptor del asistente de uso (turquesa = encendido) y "Ver guía de esta pantalla", que vuelve a mostrar la guía aunque la hayas desactivado.',
    },
    {
      target: 'menu-footer', menu: true, title: 'Privacidad',
      body: 'No hay cuentas ni registro: tus imágenes se procesan en tu equipo y no se guardan en ningún lado. Al cerrar o recargar la página el trabajo se pierde, así que descarga lo que necesites.',
    },
    ...(!ctx.isWide ? [{
      target: 'help-button', title: 'Botón de ayuda',
      body: 'El signo de interrogación muestra la guía de la pantalla en la que estás, cuando quieras.',
    }] : []),
  ];
}

const SUGERENCIA = {
  target: 'sugerencia', title: 'Sugerencia para tu imagen',
  body: 'Al cargar la imagen la app la analiza (resolución, nitidez, ruido, colores y fondo) y deja puestos los ajustes que le parecen mejores, explicando por qué. Puedes cambiarlos; "Usar ajustes sugeridos" los vuelve a poner.',
};

const BARRA = {
  target: 'barra-imagen', title: 'Tu imagen de trabajo',
  body: 'Aquí ves el nombre y el tamaño de la imagen con la que estás trabajando.',
  list: [
    ['Cambiar imagen', 'carga otra; se pierde el avance de la actual.'],
    ['Deshacer', 'regresa al estado anterior cuando aplicaste un resultado a la imagen de trabajo.'],
  ],
};

export function sectionSteps(section, ctx) {
  switch (section) {
    case 'calidad':
      return [
        { target: 'subir', title: 'Carga una imagen', body: 'Arrastra un archivo aquí, pega una imagen con Ctrl + V o toca la zona para elegirla del equipo. Acepta PNG, JPG, WEBP, GIF y BMP.' },
        BARRA,
        { target: 'visor', title: 'Visor', body: 'Muestra tu imagen. Usa − y + para acercar o alejar, el porcentaje para ajustar al visor y "100%" para ver el tamaño real. Sobre un damero gris se ven las transparencias.' },
        SUGERENCIA,
        { target: 'metodo', title: 'Método de mejora', body: 'Dos formas de mejorar la imagen:', list: [['Reconstruir detalle', 'rehace bordes, texturas y texto pequeño que faltaban, en vez de solo estirar los píxeles. Es lo más cercano a tener la imagen en mayor resolución; tarda más.'], ['Rápido', 'estira la imagen con un escalado de alta calidad y la afila; es inmediato.']], note: 'Reconstruir detalle está disponible para imágenes de hasta 1.5 megapíxeles (0.4 si tu equipo no tiene tarjeta gráfica compatible).' },
        { target: 'panel', title: 'Ajustes de mejora', body: 'Elige el tamaño final. En el método Rápido, además, el tipo de imagen y la nitidez dan un buen punto de partida que puedes afinar a tu gusto.' },
        { target: 'factor', title: 'Aumentar tamaño', body: 'Multiplica el largo y el ancho (2×, 3× o 4×) con un reescalado de alta calidad. "Igual" solo limpia y afila sin cambiar el tamaño. Debajo ves el tamaño que tendrá el resultado.' },
        { target: 'accion', title: 'Mejorar imagen', body: 'Procesa la imagen con los ajustes elegidos. Puede tardar unos segundos en imágenes grandes; verás una barra de avance.' },
        { target: 'comparar', title: 'Comparar', body: 'Cambia entre "Original" y "Mejorada" para ver la diferencia. Acércate a los bordes para notarla mejor.' },
        { target: 'resultado', title: 'Guardar el resultado', body: 'Descarga en PNG (sin pérdida) o JPG, o usa el resultado como imagen de trabajo para seguir con otra herramienta.' },
      ];
    case 'fondo':
      return [
        { target: 'subir', title: 'Carga una imagen', body: 'Arrastra un archivo aquí, pega con Ctrl + V o toca la zona para elegirlo.' },
        BARRA,
        { target: 'visor', title: 'Visor', body: 'Muestra la imagen. Cuando se quita el fondo, lo transparente se ve como un damero gris.' },
        SUGERENCIA,
        { target: 'precision', title: 'Recorte de precisión', body: 'La opción más rápida para fotos: separa al sujeto del fondo, incluso con pelo o fondos con detalle. Para más exactitud, primero encierra el objeto (recuadro, a mano alzada o silueta punto a punto) y pulsa el botón: solo se analiza esa zona. La primera vez descarga un componente de unos 200 MB; después queda guardado en tu navegador. Si algo sobra, bórralo con el pincel de retoque.' },
        { target: 'modo', title: 'Cómo detectar el fondo', body: 'Si prefieres más control, hay tres formas de trabajar:', list: [['Marcar sujeto', 'la más potente: dibujas un recuadro alrededor del sujeto y la app busca su contorno; después corriges con marcas. Ideal para fotos y personas.'], ['Automático', 'toma el color de los bordes y lo quita hacia adentro. Para fondos lisos.'], ['Por color', 'haces clic sobre el color que quieres quitar.']] },
        { target: 'marcas', title: 'Encerrar el objeto', body: 'Elige cómo marcar el objeto: "Recuadro" (arrastra para encerrarlo), "A mano" (dibuja una línea libre a su alrededor) o "Silueta" (clic punto a punto; la línea se pega sola al borde y se cierra con un clic en el punto dorado). Sirve para el recorte de precisión y para "Marcar sujeto", donde además corriges con "Verde" (lo que falta) y "Rojo" (lo que sobra).', note: 'Si algo transparente, como un vaso, se pierde, marca su borde en verde y recorta otra vez.' },
        { target: 'tolerancia', title: 'Tolerancia', body: 'Qué tan parecido al color de fondo debe ser un punto para quitarlo. Si quedan restos, súbela; si se come parte del objeto, bájala.' },
        { target: 'accion', title: 'Recortar', body: 'Calcula la transparencia. Puedes repetirlo con más marcas o ajustes las veces que quieras.' },
        { target: 'pincel', title: 'Retoque final', body: 'Corrige el resultado a mano:', list: [['Borrar', 'hace transparente lo que pintes.'], ['Restaurar', 'recupera lo que se quitó de más.']], note: 'Haz zoom para trabajar con precisión.' },
        { target: 'deshacer-retoque', title: 'Deshacer retoque', body: 'Revierte el último trazo del pincel de retoque.' },
        { target: 'resultado', title: 'Guardar el resultado', body: 'Descarga un PNG transparente o úsalo como imagen de trabajo para vectorizarlo o seguir editando. Con "Recortar el espacio vacío" el archivo queda ajustado al objeto.' },
      ];
    case 'objetos':
      return [
        { target: 'subir', title: 'Carga una imagen', body: 'Arrastra un archivo aquí, pega con Ctrl + V o toca la zona para elegirlo.' },
        BARRA,
        { target: 'visor', title: 'Marca lo que sobra', body: 'Pinta con el pincel sobre el objeto, texto o mancha que quieres quitar; se marca en rojo. Acerca la imagen para ser más preciso.' },
        { target: 'pincel', title: 'Pincel', body: '"Marcar" pinta; "Borrar marca" corrige lo que marcaste de más. El tamaño se ajusta con el deslizador; el círculo sobre la imagen muestra el área real.' },
        { target: 'accion', title: 'Eliminar lo marcado', body: 'Rellena el área usando texturas de otras partes de la imagen, como lo haría una herramienta de "relleno según contenido". El resultado se aplica directamente a la imagen.' },
        { target: 'precision', title: 'Eliminar con precisión', body: 'Si el resultado rápido no te convence, o el objeto es grande o el fondo tiene detalle, usa este botón: reconstruye lo que había detrás de forma mucho más natural. La primera vez descarga un componente de unos 200 MB; después queda guardado en tu navegador y tarda de 20 a 90 segundos.' },
        { target: 'deshacer', title: 'Deshacer', body: 'Si el relleno no te convence, regresa al estado anterior y prueba con otra calidad o marcando un área distinta.' },
      ];
    case 'vector':
      return [
        { target: 'subir', title: 'Carga una imagen', body: 'Arrastra un archivo aquí, pega con Ctrl + V o toca la zona para elegirlo. Entre más limpia y con colores definidos, mejor sale el vector.' },
        BARRA,
        { target: 'visor', title: 'Vista previa', body: 'Aquí ves tu imagen y, después de vectorizar, el resultado en vector. Puedes acercarlo cuanto quieras: no se pixela.' },
        SUGERENCIA,
        { target: 'modo', title: 'Tipo de vectorizado', body: 'Elige según tu imagen:', list: [['Logo / colores planos', 'logotipos, íconos e ilustraciones.'], ['Una tinta (B/N)', 'sellos, plantillas, corte en vinil o láser.'], ['Foto', 'efecto de ilustración por capas; el archivo pesa más.']] },
        { target: 'colores', title: 'Número de colores', body: 'Cuántos colores usará el vector. Cuéntalos en tu logo (incluye el fondo) y ajusta si se mezclan colores distintos.' },
        { target: 'accion', title: 'Vectorizar', body: 'Genera las formas vectoriales. Puede tardar un poco en imágenes grandes.' },
        { target: 'comparar', title: 'Comparar', body: 'Alterna entre el original y el vector para revisar que no se perdieron detalles.' },
        { target: 'resultado', title: 'Descargar', body: 'El SVG y el PDF vectorial se abren en Illustrator, CorelDRAW, Inkscape y Affinity, con cada color en sus propias formas editables.' },
      ];
    default:
      return [];
  }
}
