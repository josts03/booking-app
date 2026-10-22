/**
 * Column layout of the services table on large screens (header row and every
 * row share it). No "auto" column: auto sizes to each grid's own content, so
 * the header and a row would get different widths and the labels would sit
 * over the wrong fields (bug of 22. 10. 2026: "Cena" stood over "Čiščenje").
 */
export const SERVICE_GRID_LG =
  "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_5.5rem_5.5rem_6rem_6.5rem_6rem]";
