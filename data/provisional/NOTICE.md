# Third-party data notices

Some provisional inputs in this folder are derived from public catalogues.

## HYG star database v4.0

`catalog-astrometry-input.json` (positions, proper motions, distances and spectral types) is
derived from the HYG star database v4.0 by David Nash (astronexus),
<https://github.com/astronexus/HYG-Database>, licensed under the Creative Commons
Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0,
<https://creativecommons.org/licenses/by-sa/4.0/>). The derived values, including their copies in
`src/data/generated/astrometry.json`, are shared under the same licence. Changes: a subset of rows
was selected by star, converted to the project's schema and combined with the other stopgap values.

`far-stars-input.json` (Betelgeuse and Antares: positions, proper motions, distances, spectral types
and visual magnitudes) is derived from the same database under the same licence, as are its copies
in `src/data/generated/far-stars.json`. Changes: two rows selected by HIP number and converted to
the project's schema, with the parallax worked out from the distance and a display colour added.

## Open Exoplanet Catalogue

`catalog-exoplanets-input.json` (planet names, hosts, discovery years, methods, masses and orbits)
is derived from the Open Exoplanet Catalogue,
<https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue> (Rein 2012,
<https://arxiv.org/abs/1211.7121>), under this licence (from its README):

    Copyright (C) 2012 Hanno Rein

    Permission is hereby granted, free of charge, to any person obtaining a copy of this database
    and associated scripts (the "Database"), to deal in the Database without restriction, including
    without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
    and/or sell copies of the Database, and to permit persons to whom the Database is furnished to
    do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or
    substantial portions of the Database.
    A reference to the Database shall be included in all scientific publications that make use of
    the Database.

    THE DATABASE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
    BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
    NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
    DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE DATABASE OR THE USE OR OTHER DEALINGS IN THE DATABASE.
