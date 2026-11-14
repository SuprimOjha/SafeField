# Install GPM IMERG Late Run data

The assessment API reads only the local SQLite grid cache. It never logs in to NASA or downloads a file while serving a farmer request.

## One-time setup

1. Register for a free NASA Earthdata Login account and authorize the GES DISC application.
2. Add your credentials to the root `.env` file (never commit it):

```dotenv
EARTHDATA_USERNAME=your_earthdata_username
EARTHDATA_PASSWORD=your_earthdata_password
```

3. Install backend requirements and run the single fetch command from the repository's `backend` directory:

```powershell
python -m pip install -r requirements.txt
python -m app.cli fetch-imerg --days 7
```

The command searches the most recent completed UTC days, walks back up to five additional days when granules are not yet available, downloads GPM_3IMERGDL collection version 07, crops the grid to Nepal's configured bounding box and stores usable daily cells in the existing SQLite cache. It prints variable names and stops if the expected `precipitation` or `precipitation_cnt` variable is missing or the precipitation unit is unexpected.

## Dataset facts and limitations

- Product: GPM IMERG Late daily, `GPM_3IMERGDL`, CMR collection version `07` (NASA GPM currently documents the V07B algorithm line).
- Daily precipitation field: `precipitation`, in mm/day; valid-sample count: `precipitation_cnt`.
- Grid: 0.1° (~10 km). The cache stores cell centres, not a surveyed field boundary average.
- The observed UTC date is stored separately from fetch time. Publication delay varies; do not label fetch time as observation time.
- The current V07 daily Late product is kept separate from V07 Final research data. Re-check NASA CMR for product/version changes before a later deployment; V08 transition notices exist and the code deliberately fails closed if variable names/units change.

Sources: [NASA GPM precipitation data directory](https://gpm.nasa.gov/data/directory), [NASA IMERG V07 FAQ](https://gpm.nasa.gov/sites/default/files/2025-02/FAQ%20for%20IMERG%20V07%20Applications%20Users_202502.pdf), [earthaccess API documentation](https://earthaccess.readthedocs.io/en/stable/api/).

Live NASA authentication, CMR availability and a real download must be verified on the user's machine; synthetic unit tests do not validate upstream availability or scientific accuracy.
