# NASA C-MAPSS turbofan degradation data

`make train` downloads the dataset here automatically (NASA Prognostics Data Repository mirror).
If the download is not possible (offline deployment), either copy `train_FD00x.txt`, `test_FD00x.txt`
and `RUL_FD00x.txt` into this folder manually, or let AeroPulse generate a **synthetic** run-to-failure
dataset with the same schema (labelled "synthetic" throughout the UI and model card).

Reference: A. Saxena, K. Goebel, D. Simon, N. Eklund, "Damage Propagation Modeling for Aircraft Engine
Run-to-Failure Simulation", PHM 2008.
