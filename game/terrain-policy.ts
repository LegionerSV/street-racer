// Игровая аппроксимация: широкие сомнительные холмы разрешено сглаживать.
// Это параметры генератора, а не заявленная точность исходного DEM.
export const TERRAIN_OPENING_RADIUS = 2000;
export const TERRAIN_CORRECTION_LIMIT = 30;
// Открытие использует данные на расстоянии до двух радиусов, затем нужны
// запас для локальных фильтров и внутренняя область шире исходного OSM-тайла.
export const TERRAIN_GRID_SIZE = 10400;
export const TERRAIN_GRID_WIDTH = 131;
